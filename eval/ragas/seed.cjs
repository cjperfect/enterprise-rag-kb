/**
 * 种子脚本：造 12 份产品文档 → 索引到知识库 → 生成 golden 评测集
 *
 * 跑法：node eval/ragas/seed.cjs
 *
 * 前置：PG(5433) + ES(9200) + Ollama 起着
 */
const fs = require("fs");
const path = require("path");

// 加载 .env
const envPath = path.join(__dirname, "..", "..", "apps", "backend", ".env");
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { ragService } = require("../../packages/ai-engine/dist/index.js");

// ===== 12 份文档内容 =====
// 每份都有：参数表、使用说明、注意事项、故障排查 —— 让检索评测有区分度
const DOCS = [
  {
    name: "N6 mini 颈部按摩仪",
    content: `# N6 mini 颈部按摩仪

N6 mini 是一款便携颈部脉冲按摩仪，采用低频脉冲技术，缓解颈部肌肉疲劳。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 1800 mAh |
| 输入电压 | 5V |
| 设备净重 | 210 g |
| 充满时间 | 约 2.5 小时 |
| 满电按摩次数 | 约 8 次 |
| 脉冲强度 | 6 档 |
| 单次使用建议 | 不超过 15 分钟 |

## 使用步骤
1. 开机
2. 佩戴设备于颈部
3. 选择按摩模式
4. 调节强度至舒适
5. 结束并充电

## 注意事项
- 佩戴心脏起搏器者不适合使用
- 皮肤破损处避免使用
- 长期不用时每三个月充电一次

## 指示灯说明
- 红色：充电中
- 绿色：充满
- 橙色闪烁：故障

## 故障排查
- 无输出：检查电极片是否贴合皮肤
- 指示灯橙色闪烁：联系售后`,
  },
  {
    name: "NeckD5 颈部按摩仪",
    content: `# NeckD5 颈部按摩仪

NeckD5 是一款热敷+脉冲二合一颈部按摩仪，配备 42°C 恒温热敷。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 2400 mAh |
| 输入电压 | 5V/2A |
| 设备净重 | 280 g |
| 充满时间 | 约 3 小时 |
| 热敷温度 | 42°C |
| 按摩模式 | 8 种 |
| 强度档位 | 12 档 |

## 使用步骤
1. 长按电源键 2 秒开机
2. 佩戴于颈部，确保电极贴合
3. 按 M 键切换模式
4. 按 +/- 调节强度
5. 热敷键开启 42°C 热敷
6. 自动 15 分钟关机

## 注意事项
- 孕妇不建议使用
- 热敷功能不宜连续使用超过 20 分钟
- 儿童需在成人监护下使用

## 故障排查
- 热敷不热：检查热敷功能是否开启
- 蓝牙连接失败：重启手机蓝牙`,
  },
  {
    name: "N5 迷你便携按摩仪",
    content: `# N5 迷你便携按摩仪

N5 是掌心大小的迷你脉冲按摩贴，可贴于颈部、肩部、手臂、腰部等多部位。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 500 mAh |
| 输入电压 | 5V |
| 设备净重 | 65 g |
| 充满时间 | 约 1 小时 |
| 按摩模式 | 5 种 |
| 强度档位 | 10 档 |
| 防水等级 | IPX4 |

## 使用步骤
1. 撕下电极片保护膜
2. 将按摩贴贴于目标部位
3. 开机并选择模式
4. 调节强度
5. 使用后取下并盖上保护膜

## 注意事项
- IPX4 防溅水，但不可浸泡
- 电极片为一次性耗材，建议 30 次更换
- 贴于伤口处可能引起刺痛`,
  },
  {
    name: "iDream 5s 头部按摩仪",
    content: `# iDream 5s 头部按摩仪

iDream 5s 是一款头部+眼部二合一按摩仪，通过气囊按压和振动缓解头部疲劳。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 3200 mAh |
| 输入电压 | 5V/2A |
| 设备净重 | 680 g |
| 充满时间 | 约 3.5 小时 |
| 气囊压力 | 3 档 |
| 振动频率 | 20-60 Hz |
| 噪音 | < 55 dB |

## 使用步骤
1. 戴上头带并固定松紧
2. 开机选择自动模式
3. 气囊自动按压太阳穴和头顶
4. 15 分钟自动关机
5. 取下后擦拭头带

## 注意事项
- 头部受伤者禁用
- 佩戴眼镜时请取下
- 糖尿病患者使用前咨询医生`,
  },
  {
    name: "See 4 眼部按摩仪",
    content: `# See 4 眼部按摩仪

See 4 是一款眼部热敷按摩仪，结合气压、振动和热敷缓解眼疲劳。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 2000 mAh |
| 输入电压 | 5V/1A |
| 设备净重 | 320 g |
| 充满时间 | 约 2 小时 |
| 热敷温度 | 38-42°C |
| 按摩模式 | 6 种 |
| 蓝牙音乐 | 支持 |

## 使用步骤
1. 佩戴眼罩并调节松紧
2. 开机选择模式
3. 可连接蓝牙播放音乐
4. 12 分钟自动关机
5. 用后擦拭眼罩内侧

## 注意事项
- 青光眼患者禁用
- 术后恢复期禁用
- 卸妆后使用效果更佳`,
  },
  {
    name: "Air 3S 腰部按摩仪",
    content: `# Air 3S 腰部按摩仪

Air 3S 是一款腰部捶打按摩仪，配备双电机捶打和热敷功能。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 2600 mAh |
| 输入电压 | 5V/2A |
| 设备净重 | 450 g |
| 充满时间 | 约 2.5 小时 |
| 捶打力度 | 5 档 |
| 热敷温度 | 45°C |
| 电机数量 | 2 个 |

## 使用步骤
1. 将按摩仪固定于腰部
2. 开机选择捶打模式
3. 调节力度
4. 开启热敷
5. 20 分钟自动关机

## 注意事项
- 腰椎间盘突出急性期禁用
- 皮肤感知障碍者慎用
- 不可在驾驶时使用`,
  },
  {
    name: "Palm 2 手部按摩仪",
    content: `# Palm 2 手部按摩仪

Palm 2 是一款手部气压按摩仪，通过气囊按压和热敷缓解手部疲劳。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 1500 mAh |
| 输入电压 | 5V |
| 设备净重 | 380 g |
| 充满时间 | 约 1.5 小时 |
| 气囊模式 | 4 种 |
| 热敷 | 40°C |
| 适用手型 | 男女通用 |

## 使用步骤
1. 将手伸入手套
2. 开机选择气压模式
3. 气囊自动按压手掌和手指
4. 热敷功能促进血液循环
5. 10 分钟自动关机

## 注意事项
- 手部外伤禁用
- 关节炎急性发作期禁用
- 长指甲可能影响贴合`,
  },
  {
    name: "Foot 3 足部按摩仪",
    content: `# Foot 3 足部按摩仪

Foot 3 是一款足部滚轮按摩仪，配备足底滚轮刮痧和热敷。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 无（插电式） |
| 额定功率 | 45W |
| 设备净重 | 2.8 kg |
| 足底滚轮 | 3 组 |
| 热敷温度 | 45°C |
| 定时 | 15/30 分钟 |

## 使用步骤
1. 双脚放入按摩仓
2. 开机选择模式
3. 滚轮自动刮痧足底
4. 开启热敷
5. 定时结束自动关机

## 注意事项
- 糖尿病足患者慎用
- 足部皮肤破损禁用
- 每次使用不超过 30 分钟`,
  },
  {
    name: "M1 筋膜枪",
    content: `# M1 筋膜枪

M1 是一款便携式肌肉放松筋膜枪，配备 4 种按摩头。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 2600 mAh |
| 输入电压 | 12.6V |
| 设备净重 | 680 g |
| 充满时间 | 约 2 小时 |
| 转速 | 1200-3200 rpm |
| 档位 | 5 档 |
| 噪音 | < 45 dB |
| 按摩头 | 4 个（球形、扁平、圆柱、U 型） |

## 使用步骤
1. 选择合适按摩头装入
2. 开机选择档位
3. 缓慢移动于肌肉酸痛部位
4. 同一部位不超过 60 秒
5. 关机并取下按摩头清洁

## 注意事项
- 禁止击打关节、骨骼部位
- 孕妇腹部禁用
- 使用后 30 分钟内不要立即洗澡`,
  },
  {
    name: "售后政策与保修说明",
    content: `# 售后政策与保修说明

## 保修期限
- 整机保修 1 年
- 电池保修 6 个月
- 按摩头、电极片等耗材不在保修范围

## 保修范围
- 正常使用下的机器故障
- 零部件自然老化
- 工厂制造缺陷

## 不在保修范围
- 人为摔落、进水造成的损坏
- 自行拆卸
- 未按说明书使用造成的损坏
- 外观磨损

## 退换货
- 7 天无理由退货（未拆封）
- 15 天质量问题可换货
- 退换货运费由责任方承担

## 维修流程
1. 联系在线客服登记问题
2. 寄送设备到指定维修中心
3. 检测后出具维修方案
4. 维修后寄回
- 维修周期：一般 7-15 个工作日`,
  },
  {
    name: "常见问题 FAQ（一）",
    content: `# 常见问题 FAQ（一）

## Q: 设备开不了机怎么办？
A: 先连接充电器充电 30 分钟后再尝试开机。如果仍无法开机，检查充电器是否正常输出 5V。

## Q: 按摩时没有感觉？
A: 检查电极片是否贴合皮肤，皮肤干燥时可用湿毛巾擦拭后再使用。强度从低档开始逐步调节。

## Q: 可以一边充电一边使用吗？
A: 不建议。充电时使用可能影响电池寿命，且存在安全隐患。

## Q: 一次使用多长时间合适？
A: 单次建议 15 分钟，每天不超过 2 次。过度使用可能导致肌肉酸痛加重。

## Q: 设备进水了怎么办？
A: 立即关机，取出电池（可拆卸型号），置于通风处自然风干 48 小时。不可用吹风机加热烘干。

## Q: 孕妇可以使用吗？
A: 孕妇不建议使用脉冲类按摩设备，尤其是腹部和腰部。使用前请咨询医生。`,
  },
  {
    name: "常见问题 FAQ（二）",
    content: `# 常见问题 FAQ（二）

## Q: 电极片多久换一次？
A: 电极片建议每 30 次使用或 30 天更换一次。粘性下降或出现裂纹时应及时更换。

## Q: 设备可以带上飞机吗？
A: 内置锂电池设备可随身携带，但不可托运。请提前确认航空公司锂电池规定。

## Q: 热敷功能不热？
A: 检查热敷功能是否开启，热敷需要 2-3 分钟预热。若仍不热，可能是加热元件故障，联系售后。

## Q: 儿童可以使用吗？
A: 12 岁以下儿童不建议使用。12-18 岁需在成人监护下使用，强度不超过 3 档。

## Q: 充电指示灯不亮？
A: 检查充电器连接是否牢固，更换 USB 线重试。若指示灯仍不亮，可能是电池耗尽过深，充电 30 分钟后观察。

## Q: 如何清洁设备？
A: 用干布或微湿软布擦拭机身，不可用酒精或化学溶剂。电极片用清水轻洗后阴干。`,
  },
];

// ===== 对应 golden 题（每题标 expect_doc + expect_keywords） =====
// 设计意图：
//  - 大部分题是精确参数（BM25 强项）
//  - 少部分题是语义转述（向量强项）
//  - 几道陷阱题（文档里没有的答案）
const GOLDEN = [
  // N6 mini（已有 17 题，这里保留关键几题 + 新增）
  { id: "n6-001", query: "N6 mini 电池容量是多少？", expect_doc: "N6 mini", expect_keywords: ["1800 mAh"], type: "table" },
  { id: "n6-002", query: "N6 mini 充满电要多久？", expect_doc: "N6 mini", expect_keywords: ["2.5 小时"], type: "table" },
  { id: "n6-003", query: "哪些人不能用 N6 mini？", expect_doc: "N6 mini", expect_keywords: ["心脏起搏器"], type: "text" },
  { id: "n6-004", query: "N6 mini 充电时灯是什么颜色？", expect_doc: "N6 mini", expect_keywords: ["红色"], type: "text" },

  // NeckD5
  { id: "nd5-001", query: "NeckD5 的热敷温度是多少？", expect_doc: "NeckD5", expect_keywords: ["42°C"], type: "table" },
  { id: "nd5-002", query: "NeckD5 有多少种按摩模式？", expect_doc: "NeckD5", expect_keywords: ["8 种"], type: "table" },
  { id: "nd5-003", query: "NeckD5 热敷一次能开多久？", expect_doc: "NeckD5", expect_keywords: ["20 分钟"], type: "text" },

  // N5
  { id: "n5-001", query: "N5 防水等级是多少？", expect_doc: "N5", expect_keywords: ["IPX4"], type: "table" },
  { id: "n5-002", query: "N5 电极片多久换一次？", expect_doc: "N5", expect_keywords: ["30 次"], type: "text" },

  // iDream 5s
  { id: "id5-001", query: "iDream 5s 多重？", expect_doc: "iDream", expect_keywords: ["680 g"], type: "table" },
  { id: "id5-002", query: "iDream 5s 噪音大吗？", expect_doc: "iDream", expect_keywords: ["55 dB"], type: "table" },

  // See 4
  { id: "s4-001", query: "See 4 能不能连蓝牙放音乐？", expect_doc: "See 4", expect_keywords: ["蓝牙"], type: "text" },
  { id: "s4-002", query: "青光眼患者能用 See 4 吗？", expect_doc: "See 4", expect_keywords: ["禁用"], type: "text" },

  // Air 3S
  { id: "a3s-001", query: "Air 3S 腰部按摩仪有几个电机？", expect_doc: "Air 3S", expect_keywords: ["2 个"], type: "table" },
  { id: "a3s-002", query: "腰突急性期能不能用 Air 3S？", expect_doc: "Air 3S", expect_keywords: ["急性期禁用"], type: "text" },

  // Palm 2
  { id: "p2-001", query: "Palm 2 手部按摩仪热敷多少度？", expect_doc: "Palm 2", expect_keywords: ["40°C"], type: "table" },

  // Foot 3
  { id: "f3-001", query: "Foot 3 足底有几组滚轮？", expect_doc: "Foot 3", expect_keywords: ["3 组"], type: "table" },
  { id: "f3-002", query: "糖尿病人能用 Foot 3 吗？", expect_doc: "Foot 3", expect_keywords: ["慎用"], type: "text" },

  // M1 筋膜枪
  { id: "m1-001", query: "M1 筋膜枪最高转速多少？", expect_doc: "M1", expect_keywords: ["3200 rpm"], type: "table" },
  { id: "m1-002", query: "M1 带几个按摩头？", expect_doc: "M1", expect_keywords: ["4 个"], type: "table" },
  { id: "m1-003", query: "M1 能不能打关节？", expect_doc: "M1", expect_keywords: ["禁止击打关节"], type: "text" },

  // 售后政策
  { id: "as-001", query: "整机保修多长时间？", expect_doc: "售后政策", expect_keywords: ["1 年"], type: "text" },
  { id: "as-002", query: "电池保修多久？", expect_doc: "售后政策", expect_keywords: ["6 个月"], type: "text" },
  { id: "as-003", query: "质量问题多少天内可以换货？", expect_doc: "售后政策", expect_keywords: ["15 天"], type: "text" },

  // FAQ（一）
  { id: "fq1-001", query: "设备开不了机怎么办？", expect_doc: "FAQ（一）", expect_keywords: ["充电 30 分钟"], type: "text" },
  { id: "fq1-002", query: "按摩没感觉怎么回事？", expect_doc: "FAQ（一）", expect_keywords: ["电极片", "皮肤"], type: "text" },
  { id: "fq1-003", query: "能不能一边充电一边用？", expect_doc: "FAQ（一）", expect_keywords: ["不建议"], type: "text" },

  // FAQ（二）
  { id: "fq2-001", query: "电极片一般用多久要换？", expect_doc: "FAQ（二）", expect_keywords: ["30 次", "30 天"], type: "text" },
  { id: "fq2-002", query: "设备能托运上飞机吗？", expect_doc: "FAQ（二）", expect_keywords: ["不可托运", "随身携带"], type: "text" },
  { id: "fq2-003", query: "怎么清洁设备？", expect_doc: "FAQ（二）", expect_keywords: ["干布", "软布"], type: "text" },

  // 陷阱题（文档里没有的答案）
  { id: "adv-001", query: "N6 mini 的售价是多少？", expect_doc: "N6 mini", type: "adversarial", note: "所有文档都没提价格" },
  { id: "adv-002", query: "NeckD5 有没有灰色款？", expect_doc: "NeckD5", type: "adversarial", note: "文档没提颜色" },
  { id: "adv-003", query: "你们客服电话是多少？", expect_doc: "售后政策", type: "adversarial", note: "售后文档没给电话号码" },
];

async function main() {
  const KB_ID = 1;

  // 1) 索引 12 份文档
  console.log("▶ 开始索引 12 份文档...");
  for (let i = 0; i < DOCS.length; i++) {
    const doc = DOCS[i];
    process.stdout.write(`  [${i + 1}/${DOCS.length}] ${doc.name} ... `);
    const chunks = await ragService.indexDocument(KB_ID, i + 1, doc.content, {
      kbName: "倍轻松产品库",
      documentName: doc.name,
    });
    console.log(`${chunks.length} 片`);
  }

  // 2) 写 golden 集
  const goldenDir = path.join(__dirname, "..", "golden");
  fs.mkdirSync(goldenDir, { recursive: true });
  const out = path.join(goldenDir, "all-products.json");
  fs.writeFileSync(out, JSON.stringify(GOLDEN, null, 2), "utf-8");
  console.log(`\n✅ 索引完成，golden 集已写入: ${out}（${GOLDEN.length} 题）`);
}

main().catch((e) => {
  console.error("seed 失败:", e);
  process.exit(1);
});
