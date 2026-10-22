#!/usr/bin/env python3
"""
ragas 打分脚本

跑法：
  cd eval/ragas
  uv sync
  uv run python score.py

前置：
  - node eval/ragas/collect.cjs 已生成 dataset.jsonl
  - Ollama 起着（qwen3.5:0.8b 做 judge，qwen3-embedding:0.6b 做 embedding）

指标：
  - Faithfulness       忠实度：answer 里的陈述能否被 contexts 支撑
  - AnswerRelevancy    答案相关性：answer 是否切题
  - ContextPrecision   上下文精度：检索到的 contexts 里有多少是相关的
  - ContextRecall       上下文召回率：相关的 contexts 有多少被检索到了（需要 ground_truth）
"""
import json
import sys
from datetime import date
from pathlib import Path

from ragas import EvaluationDataset, evaluate
from ragas.embeddings import LangchainEmbeddingsWrapper
from ragas.llms import LangchainLLMWrapper
from ragas.metrics import (
    AnswerRelevancy,
    ContextPrecision,
    ContextRecall,
    Faithfulness,
)
from langchain_ollama import ChatOllama, OllamaEmbeddings

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "dataset.jsonl"
REPORT_DIR = ROOT.parent / "reports"

OLLAMA_BASE = "http://localhost:11434"
JUDGE_MODEL = "qwen3.5:0.8b"
EMBED_MODEL = "qwen3-embedding:0.6b"


def load_jsonl():
    """读 dataset.jsonl，返回 (ragas_dataset, meta_list)。
    meta_list 保留 id / adversarial 等业务字段，ragas 只吃标准字段。"""
    if not DATASET.exists():
        sys.exit(f"找不到 {DATASET}，先跑 node eval/ragas/collect.cjs")

    ragas_rows = []
    meta = []
    for line in DATASET.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        ragas_rows.append(
            {
                "user_input": r["question"],
                "response": r["answer"],
                "retrieved_contexts": r["contexts"],
                "reference": r["ground_truth"],
            }
        )
        meta.append(
            {
                "id": r.get("id", ""),
                "adversarial": r.get("adversarial", False),
                "type": r.get("type", ""),
            }
        )
    return EvaluationDataset.from_list(ragas_rows), meta


def build_judge():
    llm = LangchainLLMWrapper(
        ChatOllama(
            model=JUDGE_MODEL,
            base_url=OLLAMA_BASE,
            temperature=0.0,
            reasoning=False,  # qwen3.5 默认开 thinking，会先生成一堆 reasoning token 导致超时
            num_predict=512,
        )
    )
    emb = LangchainEmbeddingsWrapper(
        OllamaEmbeddings(
            model=EMBED_MODEL,
            base_url=OLLAMA_BASE,
        )
    )
    return llm, emb


def render_report(result, meta) -> str:
    df = result.to_pandas()
    today = date.today().isoformat()

    lines = [
        f"# ragas 评测报告 {today}",
        "",
        f"- judge LLM: ollama/{JUDGE_MODEL}",
        f"- embedding: ollama/{EMBED_MODEL}",
        f"- 题目数: {len(df)}（含 {sum(1 for m in meta if m['adversarial'])} 道陷阱题）",
        "",
        "- 汇总仅包含正常题；陷阱题的召回与忠实度分数不能用于判断拒答。陷阱题最终回答需单独人工审核。",
        "- 当前 reference 可能由关键词拼接，ContextRecall 仅作粗略诊断。",
        "",
        "## 汇总指标",
        "",
        "| 指标 | 均值 | 说明 |",
        "| --- | --- | --- |",
    ]

    metric_desc = {
        "faithfulness": "answer 被 contexts 支撑的比例（越高越忠实）",
        "answer_relevancy": "answer 与 question 的语义相关性（越高越切题）",
        "context_precision": "检索到的 contexts 中相关切片的占比",
        "context_recall": "reference 中的信息有多少被检索到的 contexts 覆盖",
    }
    metric_cols = [c for c in df.columns if c not in ("user_input", "response", "retrieved_contexts", "reference")]
    normal_mask = [not m["adversarial"] for m in meta]
    for col in metric_cols:
        mean = df.loc[normal_mask, col].mean()
        desc = metric_desc.get(col, "")
        lines.append(f"| {col} | {mean:.3f} | {desc} |")

    # 逐题明细（按行号对齐 meta）
    lines += [
        "",
        "## 逐题明细",
        "",
        "| ID | 类型 | 问题 | Faithfulness | AnswerRelevancy | ContextPrecision | ContextRecall |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for i, row in df.iterrows():
        m = meta[i]
        tag = "🚨陷阱" if m["adversarial"] else m["type"]
        q = str(row["user_input"]).replace("|", "∣")[:40]

        def fmt(col):
            if m["adversarial"]:
                return "N/A"
            v = row.get(col, float("nan"))
            try:
                return f"{float(v):.2f}"
            except (TypeError, ValueError):
                return str(v)

        lines.append(
            f"| {m['id']} | {tag} | {q} | "
            f"{fmt('faithfulness')} | {fmt('answer_relevancy')} | "
            f"{fmt('context_precision')} | {fmt('context_recall')} |"
        )

    # 低分题
    lines += ["", "## 低分题（任一指标 < 0.5，需关注）", ""]
    low_mask = (
        (df.get("faithfulness", 1) < 0.5)
        | (df.get("answer_relevancy", 1) < 0.5)
        | (df.get("context_precision", 1) < 0.5)
    )
    low = df[low_mask & normal_mask]
    if len(low) == 0:
        lines.append("- 无")
    for i, row in low.iterrows():
        m = meta[i]
        lines.append(f"### {m['id']} {row['user_input']}")
        lines.append(f"- 类型: {'陷阱题' if m['adversarial'] else m['type']}")
        lines.append(f"- answer: {str(row['response'])[:200]}")
        ctx = row.get("retrieved_contexts", [])
        lines.append(f"- contexts ({len(ctx)} 片):")
        for j, c in enumerate(ctx[:3]):
            lines.append(f"  - [{j+1}] {str(c)[:150]}")
        lines.append("")

    lines += ["", "## 陷阱题最终回答（待人工审核是否拒答及是否含无依据断言）", ""]
    for i, row in df.iterrows():
        if meta[i]["adversarial"]:
            lines.append(f"- [{meta[i]['id']}] {row['user_input']}：{row['response']}")
    return "\n".join(lines)


def main():
    print("▶ 加载 dataset.jsonl ...")
    dataset, meta = load_jsonl()
    print(f"▶ 共 {len(dataset)} 条，配置 judge = ollama/{JUDGE_MODEL} ...")
    llm, emb = build_judge()

    print("▶ 跑 ragas 评测（0.8b 模型较慢，耐心等）...")
    result = evaluate(
        dataset=dataset,
        metrics=[
            Faithfulness(),
            AnswerRelevancy(),
            ContextPrecision(),
            ContextRecall(),
        ],
        llm=llm,
        embeddings=emb,
        raise_exceptions=False,
    )

    print("\n▶ 汇总：")
    print(result)

    report = render_report(result, meta)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    out = REPORT_DIR / f"ragas-{date.today().isoformat()}.md"
    out.write_text(report, encoding="utf-8")
    print(f"\n报告已写入: {out}")


if __name__ == "__main__":
    main()
