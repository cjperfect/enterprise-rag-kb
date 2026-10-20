# ragas 评测

用 [ragas](https://docs.ragas.io/) 对 RAG 链路做 LLM-as-judge 量化评测。

## 跑法

```bash
# 1. 确保 PG / ES / Ollama 起着，且 packages/ai-engine 已 build
pnpm --filter @langchain-rag/ai-engine build

# 2. 收集数据（对 golden/ 每题真实跑一遍 chat，落 dataset.jsonl）
node eval/ragas/collect.cjs

# 3. 装 Python 依赖（首次跑）
cd eval/ragas && uv sync

# 4. ragas 打分，输出 markdown 报告到 eval/reports/ragas-YYYY-MM-DD.md
uv run python score.py
```

## 指标说明

| 指标 | 含义 | 越低说明什么问题 |
| --- | --- | --- |
| Faithfulness | answer 里的陈述能否被检索到的 contexts 支撑 | 模型在编 context 里没有的内容（幻觉） |
| AnswerRelevancy | answer 是否切题、没有废话 | 答非所问 / 套话 |
| ContextPrecision | 检索到的 top-k 里有多少是真相关的 | 检索噪音大，k 调大反而稀释信号 |
| ContextRecall | reference（标准答案）里的信息有多少被 contexts 覆盖 | 该召回的没召回，索引/切片/embedding 有问题 |

## 已知限制

- **judge 模型小**：当前用 `qwen3.5:0.8b` 做 judge，推理能力有限，分数仅供横向对比（同一配置前后对比），不要绝对值外推。若要更准，`ollama pull qwen3:4b` 或更大模型，改 `score.py` 里的 `JUDGE_MODEL`。
- **ground_truth 是拼出来的**：golden 集只有 expect_keywords，没有标准答案全文，ContextRecall 分数粗糙。想要准，给 golden 条目加 `ground_truth` 字段（一句完整答案）。
- **陷阱题**：adversarial 题（知识库中没有答案）的 faithfulness 可能天然偏低——answer 说"不知道"而 contexts 是空的，ragas 的 faithfulness 提示词未必能正确处理"拒答即忠实"这种语义。看报告时单独扫一眼陷阱题那行。

## 文件

- `collect.cjs` — Node 数据收集，调 AiEngine.streamEvents，落 `dataset.jsonl`
- `score.py` — Python 打分，ragas + Ollama
- `pyproject.toml` — uv 管理的 Python 依赖
- `dataset.jsonl` — 中间产物（每条一行：question/answer/contexts/ground_truth）
