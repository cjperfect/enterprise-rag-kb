/**
 * 表格保护切片验证：md 裸 GFM 表格、PDF 式 [表格] 块、假阳性单行、正文正常切分
 * 跑法：node test-fixtures/eval-table-split.cjs
 */
const aiEngine = require("../packages/ai-engine/dist/index.js");

const { splitTextToChunks } = aiEngine;

if (typeof splitTextToChunks !== "function") {
  console.error("splitTextToChunks 未导出。当前导出键：", Object.keys(aiEngine));
  process.exit(1);
}

const text = `# 倍轻松 N6mini 说明书

## 产品参数
N6mini 采用轻量化设计，整机重量约 150g，适合长时间佩戴按摩。机身尺寸紧凑，支持多种模式切换，日常使用体验舒适，充电便捷。

| 参数项 | 规格 |
| --- | --- |
| 产品型号 | N6mini |
| 整机重量 | 约 150g |
| 充电电压 | 5V 1A |
| 续航时间 | 约 120 分钟 |

## 充电说明
首次使用前请充电 2 小时。充电时指示灯红色常亮，充满后绿灯常亮。
| 注意事项：请勿在浴室与淋浴环境下使用本产品 |

[表格]
| 模式 | 时长 | 强度档位 |
| --- | --- | --- |
| 舒缓 | 15min | 3 档 |
| 活力 | 10min | 5 档 |

## 保修
本产品自购买之日起保修一年，人为损坏不在保修范围内。请保留好购买凭证以便享受保修服务。
`;

(async () => {
  const chunks = await splitTextToChunks(text, { preserveTables: true });
  console.log(`共 ${chunks.length} 个 chunk：\n`);
  chunks.forEach((c, i) => {
    console.log(`--- chunk ${i + 1} (${c.length} 字) ---`);
    console.log(c);
    console.log("");
  });

  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`❌ ${msg}`);
      process.exitCode = 1;
    } else {
      console.log(`✅ ${msg}`);
    }
  };

  // 1. md 裸表格整块：同一个 chunk 同时含表头和最后一行数据
  const mdTableChunk = chunks.find(
    (c) => c.includes("产品型号") && c.includes("续航时间"),
  );
  assert(!!mdTableChunk, "md 裸 GFM 表格整块在一个 chunk 里（未被切散）");

  // 2. PDF 式 [表格] 块整块
  const pdfTableChunk = chunks.find(
    (c) => c.startsWith("[表格]") && c.includes("舒缓") && c.includes("活力"),
  );
  assert(!!pdfTableChunk, "PDF 式 [表格] 块整块在一个 chunk 里");

  // 3. 假阳性单行没有被吞进表格，仍出现在普通文本 chunk
  const fakePositiveKept = chunks.some((c) =>
    c.includes("注意事项：请勿在浴室"),
  );
  assert(fakePositiveKept, "假阳性单行 | 没有被误判为表格，仍保留在正文里");

  // 4. 正文被正常切分（至少有一个 chunk 不含任何表格行）
  const plainChunk = chunks.find((c) => !c.includes("|") && c.length > 20);
  assert(!!plainChunk, "普通正文仍被正常切分");
})();
