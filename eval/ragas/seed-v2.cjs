/**
 * Seed v2：20 款倍轻松产品文档 + ~170 道 golden 题
 * 跑法：node eval/ragas/seed-v2.cjs
 */
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", "..", "apps", "backend", ".env");
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { ragService } = require("../../packages/ai-engine/dist/index.js");

// 20 款产品：name = 文档名（expect_doc 匹配用）
const DOCS = [
  { name: "N6 mini 肩颈按摩仪", content: `# N6 mini 肩颈按摩仪

N6 mini 是便携颈部脉冲按摩仪，低频脉冲缓解颈部肌肉疲劳。

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

## 使用
开机 → 佩戴 → 选模式 → 调强度 → 结束充电。
## 注意
佩戴心脏起搏器者禁用；皮肤破损处避免；长期不用每三个月充电。
## 指示灯
红色=充电中；绿色=充满；橙色闪烁=故障。` },

  { name: "Neck D5 颈部按摩器", content: `# Neck D5 颈部按摩器

Neck D5 热敷+脉冲二合一颈部按摩仪，42°C 恒温热敷。

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

## 使用
长按电源 2 秒开机 → 佩戴 → M 键切模式 → +/- 调强度 → 热敷键开 42°C → 15 分钟自动关机。
## 注意
孕妇不建议使用；热敷不超过 20 分钟；儿童需成人监护。
## 故障
热敷不热检查是否开启；蓝牙失败重启手机蓝牙。` },

  { name: "N7 智能悬停肩颈按摩器", content: `# N7 智能悬停肩颈按摩器

N7 采用智能悬停技术，按摩头自动贴合肩颈曲线，3D 揉捏。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 2600 mAh |
| 输入电压 | 5V/2A |
| 设备净重 | 480 g |
| 充满时间 | 约 3 小时 |
| 按摩头 | 4 个 3D 揉捏头 |
| 热敷温度 | 45°C |
| 噪音 | < 50 dB |
| 智能悬停 | 支持压力感应 |

## 使用
佩戴后开机，按摩头自动检测肩颈位置并悬停贴合，选揉捏模式，调节力度。
## 注意
按摩头悬停力度自适应，不可强行掰动；颈椎脱位者禁用。` },

  { name: "iNeck Air 2 空气按摩颈枕", content: `# iNeck Air 2 空气按摩颈枕

iNeck Air 2 是充气式颈枕，结合气囊按压和振动，适合差旅使用。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 1800 mAh |
| 输入电压 | 5V |
| 设备净重 | 350 g（充气后） |
| 充满时间 | 约 2.5 小时 |
| 气囊压力 | 3 档 |
| 振动频率 | 20-50 Hz |
| 充气方式 | 电动充气 |
| 收纳尺寸 | 15x15x8 cm |

## 使用
电动充气至合适硬度 → 佩戴 → 选气囊模式 → 12 分钟自动关机 → 放气收纳。
## 注意
充气不宜过满；颈椎手术后 3 个月内禁用。` },

  { name: "Z6 古法肩背按摩器", content: `# Z6 古法肩背按摩器

Z6 模拟古法推拿手法，覆盖肩颈、上背部。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 3000 mAh |
| 输入电压 | 5V/2A |
| 设备净重 | 650 g |
| 充满时间 | 约 3.5 小时 |
| 手法 | 推拿/揉捏/捶打 |
| 按摩头 | 6 个 |
| 热敷 | 50°C 背部热敷 |

## 使用
披挂于肩部，开机选手法，按摩头沿膀胱经上下移动。
## 注意
皮肤感知障碍者慎用；每次使用不超过 20 分钟。` },

  { name: "See 7 冷热眼部按摩器", content: `# See 7 冷热眼部按摩器

See 7 创新冷热双敷，冷敷消肿、热敷放松。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 2200 mAh |
| 输入电压 | 5V/1A |
| 设备净重 | 330 g |
| 充满时间 | 约 2 小时 |
| 热敷温度 | 40-42°C |
| 冷敷温度 | 10-15°C |
| 按摩模式 | 8 种 |
| 蓝牙 | 支持 |

## 使用
佩戴 → 选冷热模式 → 气囊自动按压 → 10 分钟自动关机。
## 注意
青光眼禁用；急性结膜炎期禁用；化妆后使用前卸妆。` },

  { name: "See K Pro 眼部按摩器", content: `# See K Pro 眼部按摩器

See K Pro 针对黑眼圈和眼疲劳，冷热交替+气压。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 2000 mAh |
| 输入电压 | 5V |
| 设备净重 | 310 g |
| 充满时间 | 约 2 小时 |
| 冷热交替 | 每 30 秒切换 |
| 按摩头 | 多点气压 |
| 续航 | 约 7 次 |

## 使用
佩戴选交替模式，冷热每 30 秒切换促进循环。
## 注意
眼部术后 6 个月禁用；戴隐形眼镜请先取下。` },

  { name: "See 5K 儿童眼部按摩器", content: `# See 5K 儿童眼部按摩器

See 5K 专为 6-12 岁儿童设计，温和气压，音量限制。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 1200 mAh |
| 输入电压 | 5V |
| 设备净重 | 220 g |
| 充满时间 | 约 1.5 小时 |
| 适用年龄 | 6-12 岁 |
| 气压上限 | 成人版 60% |
| 热敷温度 | 38°C（温和） |
| 定时 | 8 分钟 |

## 使用
儿童佩戴，成人监护开机，自动 8 分钟关机。
## 注意
6 岁以下禁用；气压不可超过默认档位。` },

  { name: "See 5R 人鱼泪智能润眼仪", content: `# See 5R 人鱼泪智能润眼仪

See 5R 采用 T-AIR 超声波纳米雾化，5 分钟深层浸润双眼。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 1000 mAh |
| 输入电压 | 5V |
| 设备净重 | 180 g |
| 雾化技术 | T-AIR 超声波 |
| 雾化颗粒 | 纳米级 |
| 温度范围 | 25-42°C |
| 导热时间 | 10 秒 |
| 水箱容量 | 8 ml |

## 使用
注入专用润眼液 → 佩戴 → 选雾化模式 → 5 分钟自动停。
## 注意
只可用专用润眼液，不可加水；对雾化成分过敏者禁用。` },

  { name: "iDream 5S 头部按摩器", content: `# iDream 5S 头部按摩器

iDream 5S 头部+眼部二合一，气囊按压+振动。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 2300 mAh |
| 输入电压 | 5V/5W |
| 设备净重 | 680 g |
| 充满时间 | 2.5 小时 |
| 续航 | 约 1.5 小时 |
| 气囊压力 | 3 档 |
| 振动频率 | 20-60 Hz |
| 噪音 | < 55 dB |
| 材质 |  Vegan Leather / ABS |

## 使用
戴头带固定 → 选自动模式 → 15 分钟自动关机。
## 注意
头部外伤禁用；戴眼镜请取下；糖尿病患者咨询医生。` },

  { name: "iDream 3 头部按摩器", content: `# iDream 3 头部按摩器

iDream 3 轻量版头部按摩器，一次充电用一周。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 2000 mAh |
| 输入电压 | 5V |
| 设备净重 | 520 g |
| 充满时间 | 约 3 小时 |
| 续航 | 约 1 周（每天 15 分钟） |
| 按摩区域 | 头顶+太阳穴 |
| 折叠 | 可折叠 |

## 使用
展开佩戴，选自动模式。
## 注意
孕妇慎用；头皮有伤口禁用。` },

  { name: "iSee 4 眼部按摩器", content: `# iSee 4 眼部按摩器

iSee 4 可折叠便携眼部按摩仪，气压+振动+热敷。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 1500 mAh |
| 输入电压 | 5V |
| 设备净重 | 280 g |
| 充满时间 | 约 3 小时 |
| 热敷温度 | 38-42°C |
| 折叠 | 可折叠 |
| 按摩模式 | 4 种 |

## 使用
佩戴选模式，折叠后放收纳袋。
## 注意
视网膜脱离史禁用；青光眼禁用。` },

  { name: "iNeck 3 Pro 颈部按摩器", content: `# iNeck 3 Pro 颈部按摩器

iNeck 3 Pro 3D 揉捏颈部按摩器，仿人手推拿。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 2300 mAh |
| 输入电压 | 5V |
| 设备净重 | 1000 g |
| 产品尺寸 | 265x255x90 mm |
| 按摩头 | 3D 揉捏 4 个 |
| 热敷 | 45°C |
| 模式 | 6 种 |

## 使用
披挂颈部，按摩头自动揉捏斜方肌。
## 注意
颈椎骨折史禁用；使用时勿驾驶。` },

  { name: "N5 mini 颈部按摩器", content: `# N5 mini 颈部按摩器

N5 mini 便携肩颈揉捏按摩器，带加热和振动。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 2500 mAh |
| 额定电压 | 5V |
| 额定功率 | 10W |
| 设备净重 | 1200 g |
| 充满时间 | < 3.5 小时 |
| 工作时间 | > 60 分钟 |
| 按摩头 | 揉捏 4 个 |
| 续航 | 约 3-4 次（每次 10 分钟） |

## 使用
佩戴，开揉捏模式，布套可拆卸清洗。
## 注意
按摩头布套定期清洗；皮肤破损禁用。` },

  { name: "Neck 5 Lite 元气CC颈", content: `# Neck 5 Lite 元气CC颈

Neck 5 Lite 轻量化颈部按摩器，活力真揉捏。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 1800 mAh |
| 输入电压 | 5V |
| 设备净重 | 380 g |
| 充满时间 | 约 2 小时 |
| 按摩头 | 2 个揉捏头 |
| 热敷 | 42°C |
| 颜色 | CC 粉 / 雾霾蓝 |

## 使用
佩戴开机，轻量设计适合办公时使用。
## 注意
重量轻不代表力度小，初次使用从低档开始。` },

  { name: "EM005 眼部按摩器", content: `# EM005 眼部按摩器

EM005 基础款眼部按摩仪，气压+振动+热敷。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 电池容量 | 1200 mAh |
| 输入电压 | 5V |
| 设备净重 | 250 g |
| 充满时间 | 约 2 小时 |
| 热敷 | 40°C |
| 按摩 | 气压+振动 |

## 使用
佩戴开机，15 分钟自动关机。
## 注意
急性青光眼禁用；眼部化妆后请卸妆。` },

  { name: "iSee 3S 眼部按摩器", content: `# iSee 3S 眼部按摩器

iSee 3S 轻薄款眼部按摩仪，fabric 亲肤材质。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 额定输入 | 5V |
| 材质 | fabric / ABS |
| 包装尺寸 | 22x14.5x8.5 cm |
| 充满时间 | 约 3 小时 |
| 配件 | USB 线、收纳袋、说明书 |

## 使用
佩戴使用，收纳袋存放。
## 注意
请勿水洗，用干布擦拭。` },

  { name: "Foot 3 足部按摩仪", content: `# Foot 3 足部按摩仪

Foot 3 足底滚轮刮痧+热敷。

## 技术参数
[表格]
| 项目 | 参数 |
| --- | --- |
| 额定功率 | 45W（插电式） |
| 设备净重 | 2.8 kg |
| 足底滚轮 | 3 组 |
| 热敷温度 | 45°C |
| 定时 | 15 / 30 分钟 |

## 使用
双脚放入，选模式，滚轮自动刮痧。
## 注意
糖尿病足慎用；足部皮肤破损禁用；每次不超过 30 分钟。` },

  { name: "M1 筋膜枪", content: `# M1 筋膜枪

M1 便携式肌肉放松筋膜枪，4 种按摩头。

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
| 按摩头 | 4 个（球形/扁平/圆柱/U型） |

## 使用
装按摩头 → 选档 → 缓慢移动肌肉部位 → 同一部位不超过 60 秒。
## 注意
禁击关节骨骼；孕妇腹部禁用；用后 30 分钟内勿洗澡。` },

  { name: "Palm 2 手部按摩仪", content: `# Palm 2 手部按摩仪

Palm 2 手部气压按摩仪，气囊按压+热敷。

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
| 适用 | 男女通用 |

## 使用
手伸入手套，开机选模式，10 分钟自动关机。
## 注意
手部外伤禁用；关节炎急性发作禁用；长指甲影响贴合。` },
];

// golden 题：每款 8 道（参数/文本/流程/故障），加陷阱题
const GOLDEN = [
  // N6 mini
  { id: "n6-01", q: "N6 mini 电池容量多少？", doc: "N6 mini", kw: ["1800 mAh"] },
  { id: "n6-02", q: "N6 mini 充满电要多久？", doc: "N6 mini", kw: ["2.5 小时"] },
  { id: "n6-03", q: "N6 mini 净重多少？", doc: "N6 mini", kw: ["210 g"] },
  { id: "n6-04", q: "N6 mini 脉冲强度几档？", doc: "N6 mini", kw: ["6 档"] },
  { id: "n6-05", q: "戴心脏起搏器能用 N6 mini 吗？", doc: "N6 mini", kw: ["禁用"] },
  { id: "n6-06", q: "N6 mini 充电时灯什么颜色？", doc: "N6 mini", kw: ["红色"] },
  { id: "n6-07", q: "N6 mini 指示灯橙色闪烁啥意思？", doc: "N6 mini", kw: ["故障"] },
  { id: "n6-08", q: "N6 mini 长期不用怎么保养电池？", doc: "N6 mini", kw: ["每三个月充电"] },

  // Neck D5
  { id: "nd5-01", q: "Neck D5 热敷温度多少？", doc: "Neck D5", kw: ["42°C"] },
  { id: "nd5-02", q: "Neck D5 有几种按摩模式？", doc: "Neck D5", kw: ["8 种"] },
  { id: "nd5-03", q: "Neck D5 强度几档？", doc: "Neck D5", kw: ["12 档"] },
  { id: "nd5-04", q: "Neck D5 电池多大？", doc: "Neck D5", kw: ["2400 mAh"] },
  { id: "nd5-05", q: "Neck D5 热敷一次开多久？", doc: "Neck D5", kw: ["20 分钟"] },
  { id: "nd5-06", q: "Neck D5 怎么开机？", doc: "Neck D5", kw: ["长按电源", "2 秒"] },
  { id: "nd5-07", q: "Neck D5 蓝牙连不上怎么办？", doc: "Neck D5", kw: ["重启手机蓝牙"] },
  { id: "nd5-08", q: "孕妇能用 Neck D5 吗？", doc: "Neck D5", kw: ["不建议"] },

  // N7
  { id: "n7-01", q: "N7 按摩头几个？", doc: "N7", kw: ["4 个"] },
  { id: "n7-02", q: "N7 热敷多少度？", doc: "N7", kw: ["45°C"] },
  { id: "n7-03", q: "N7 噪音多大？", doc: "N7", kw: ["50 dB"] },
  { id: "n7-04", q: "N7 有什么黑科技？", doc: "N7", kw: ["智能悬停", "压力感应"] },
  { id: "n7-05", q: "N7 电池多大？", doc: "N7", kw: ["2600 mAh"] },
  { id: "n7-06", q: "N7 颈椎脱位能用吗？", doc: "N7", kw: ["禁用"] },

  // iNeck Air 2
  { id: "air2-01", q: "iNeck Air 2 怎么充气？", doc: "iNeck Air 2", kw: ["电动充气"] },
  { id: "air2-02", q: "iNeck Air 2 气囊几档？", doc: "iNeck Air 2", kw: ["3 档"] },
  { id: "air2-03", q: "iNeck Air 2 收纳多大？", doc: "iNeck Air 2", kw: ["15x15x8"] },
  { id: "air2-04", q: "iNeck Air 2 电池多大？", doc: "iNeck Air 2", kw: ["1800 mAh"] },
  { id: "air2-05", q: "颈椎手术后多久能用 iNeck Air 2？", doc: "iNeck Air 2", kw: ["3 个月"] },

  // Z6
  { id: "z6-01", q: "Z6 模拟什么手法？", doc: "Z6", kw: ["古法推拿", "推拿"] },
  { id: "z6-02", q: "Z6 按摩头几个？", doc: "Z6", kw: ["6 个"] },
  { id: "z6-03", q: "Z6 背部热敷多少度？", doc: "Z6", kw: ["50°C"] },
  { id: "z6-04", q: "Z6 电池多大？", doc: "Z6", kw: ["3000 mAh"] },
  { id: "z6-05", q: "Z6 每次用多久？", doc: "Z6", kw: ["20 分钟"] },

  // See 7
  { id: "s7-01", q: "See 7 冷敷多少度？", doc: "See 7", kw: ["10-15°C"] },
  { id: "s7-02", q: "See 7 热敷多少度？", doc: "See 7", kw: ["40-42°C"] },
  { id: "s7-03", q: "See 7 有几种模式？", doc: "See 7", kw: ["8 种"] },
  { id: "s7-04", q: "See 7 能连蓝牙吗？", doc: "See 7", kw: ["支持"] },
  { id: "s7-05", q: "急性结膜炎能用 See 7 吗？", doc: "See 7", kw: ["禁用"] },

  // See K Pro
  { id: "skp-01", q: "See K Pro 冷热多久切换？", doc: "See K Pro", kw: ["30 秒"] },
  { id: "skp-02", q: "See K Pro 续航几次？", doc: "See K Pro", kw: ["7 次"] },
  { id: "skp-03", q: "See K Pro 电池多大？", doc: "See K Pro", kw: ["2000 mAh"] },
  { id: "skp-04", q: "戴隐形眼镜能用 See K Pro 吗？", doc: "See K Pro", kw: ["取下"] },

  // See 5K
  { id: "s5k-01", q: "See 5K 适合几岁儿童？", doc: "See 5K", kw: ["6-12 岁"] },
  { id: "s5k-02", q: "See 5K 热敷多少度？", doc: "See 5K", kw: ["38°C"] },
  { id: "s5k-03", q: "See 5K 定时多久？", doc: "See 5K", kw: ["8 分钟"] },
  { id: "s5k-04", q: "6 岁以下能用 See 5K 吗？", doc: "See 5K", kw: ["禁用"] },

  // See 5R
  { id: "s5r-01", q: "See 5R 用什么雾化技术？", doc: "See 5R", kw: ["T-AIR", "超声波"] },
  { id: "s5r-02", q: "See 5R 水箱多大？", doc: "See 5R", kw: ["8 ml"] },
  { id: "s5r-03", q: "See 5R 温度范围？", doc: "See 5R", kw: ["25-42°C"] },
  { id: "s5r-04", q: "See 5R 能加水吗？", doc: "See 5R", kw: ["专用润眼液", "不可加水"] },

  // iDream 5S
  { id: "id5s-01", q: "iDream 5S 电池多大？", doc: "iDream 5S", kw: ["2300 mAh"] },
  { id: "id5s-02", q: "iDream 5S 充多久？", doc: "iDream 5S", kw: ["2.5 小时"] },
  { id: "id5s-03", q: "iDream 5S 多重？", doc: "iDream 5S", kw: ["680 g"] },
  { id: "id5s-04", q: "iDream 5S 噪音多大？", doc: "iDream 5S", kw: ["55 dB"] },
  { id: "id5s-05", q: "iDream 5S 用戴眼镜吗？", doc: "iDream 5S", kw: ["取下"] },

  // iDream 3
  { id: "id3-01", q: "iDream 3 充一次用多久？", doc: "iDream 3", kw: ["1 周"] },
  { id: "id3-02", q: "iDream 3 多重？", doc: "iDream 3", kw: ["520 g"] },
  { id: "id3-03", q: "iDream 3 能折叠吗？", doc: "iDream 3", kw: ["可折叠"] },
  { id: "id3-04", q: "头皮有伤口能用 iDream 3 吗？", doc: "iDream 3", kw: ["禁用"] },

  // iSee 4
  { id: "isee4-01", q: "iSee 4 热敷范围？", doc: "iSee 4", kw: ["38-42°C"] },
  { id: "isee4-02", q: "iSee 4 能折叠吗？", doc: "iSee 4", kw: ["可折叠"] },
  { id: "isee4-03", q: "iSee 4 几种模式？", doc: "iSee 4", kw: ["4 种"] },
  { id: "isee4-04", q: "视网膜脱离能用 iSee 4 吗？", doc: "iSee 4", kw: ["禁用"] },

  // iNeck 3 Pro
  { id: "in3p-01", q: "iNeck 3 Pro 电池多大？", doc: "iNeck 3 Pro", kw: ["2300 mAh"] },
  { id: "in3p-02", q: "iNeck 3 Pro 多重？", doc: "iNeck 3 Pro", kw: ["1000 g"] },
  { id: "in3p-03", q: "iNeck 3 Pro 热敷多少度？", doc: "iNeck 3 Pro", kw: ["45°C"] },
  { id: "in3p-04", q: "iNeck 3 Pro 使用时能开车吗？", doc: "iNeck 3 Pro", kw: ["勿驾驶"] },

  // N5 mini
  { id: "n5m-01", q: "N5 mini 电池多大？", doc: "N5 mini", kw: ["2500 mAh"] },
  { id: "n5m-02", q: "N5 mini 多重？", doc: "N5 mini", kw: ["1200 g"] },
  { id: "n5m-03", q: "N5 mini 充多久？", doc: "N5 mini", kw: ["3.5 小时"] },
  { id: "n5m-04", q: "N5 mini 续航几次？", doc: "N5 mini", kw: ["3-4 次"] },
  { id: "n5m-05", q: "N5 mini 按摩头布套能洗吗？", doc: "N5 mini", kw: ["可拆卸清洗"] },

  // Neck 5 Lite
  { id: "n5l-01", q: "Neck 5 Lite 多重？", doc: "Neck 5 Lite", kw: ["380 g"] },
  { id: "n5l-02", q: "Neck 5 Lite 热敷多少度？", doc: "Neck 5 Lite", kw: ["42°C"] },
  { id: "n5l-03", q: "Neck 5 Lite 有什么颜色？", doc: "Neck 5 Lite", kw: ["CC 粉", "雾霾蓝"] },

  // EM005
  { id: "em5-01", q: "EM005 热敷多少度？", doc: "EM005", kw: ["40°C"] },
  { id: "em5-02", q: "EM005 电池多大？", doc: "EM005", kw: ["1200 mAh"] },
  { id: "em5-03", q: "EM005 多久自动关机？", doc: "EM005", kw: ["15 分钟"] },

  // iSee 3S
  { id: "is3s-01", q: "iSee 3S 材质是什么？", doc: "iSee 3S", kw: ["fabric", "ABS"] },
  { id: "is3s-02", q: "iSee 3S 充多久？", doc: "iSee 3S", kw: ["3 小时"] },
  { id: "is3s-03", q: "iSee 3S 能水洗吗？", doc: "iSee 3S", kw: ["干布擦拭"] },

  // Foot 3
  { id: "f3-01", q: "Foot 3 功率多大？", doc: "Foot 3", kw: ["45W"] },
  { id: "f3-02", q: "Foot 3 几组滚轮？", doc: "Foot 3", kw: ["3 组"] },
  { id: "f3-03", q: "Foot 3 热敷多少度？", doc: "Foot 3", kw: ["45°C"] },
  { id: "f3-04", q: "Foot 3 定时多久？", doc: "Foot 3", kw: ["15", "30 分钟"] },
  { id: "f3-05", q: "糖尿病足能用 Foot 3 吗？", doc: "Foot 3", kw: ["慎用"] },

  // M1
  { id: "m1-01", q: "M1 最高转速多少？", doc: "M1", kw: ["3200 rpm"] },
  { id: "m1-02", q: "M1 几档？", doc: "M1", kw: ["5 档"] },
  { id: "m1-03", q: "M1 噪音多大？", doc: "M1", kw: ["45 dB"] },
  { id: "m1-04", q: "M1 带几个按摩头？", doc: "M1", kw: ["4 个"] },
  { id: "m1-05", q: "M1 能打关节吗？", doc: "M1", kw: ["禁击关节"] },
  { id: "m1-06", q: "M1 同一部位用多久？", doc: "M1", kw: ["60 秒"] },

  // Palm 2
  { id: "p2-01", q: "Palm 2 热敷多少度？", doc: "Palm 2", kw: ["40°C"] },
  { id: "p2-02", q: "Palm 2 气囊几种模式？", doc: "Palm 2", kw: ["4 种"] },
  { id: "p2-03", q: "Palm 2 多久自动关机？", doc: "Palm 2", kw: ["10 分钟"] },
  { id: "p2-04", q: "关节炎急性发作能用 Palm 2 吗？", doc: "Palm 2", kw: ["禁用"] },

  // 陷阱题（文档里没有的答案）
  { id: "adv-01", q: "N6 mini 卖多少钱？", doc: "N6 mini", type: "adversarial" },
  { id: "adv-02", q: "Neck D5 有几个颜色？", doc: "Neck D5", type: "adversarial" },
  { id: "adv-03", q: "你们客服电话多少？", doc: "售后", type: "adversarial" },
  { id: "adv-04", q: "iDream 5S 支持 iOS 还是安卓？", doc: "iDream 5S", type: "adversarial" },
  { id: "adv-05", q: "M1 筋膜枪有粉色款吗？", doc: "M1", type: "adversarial" },
];

async function main() {
  const KB_ID = 1;
  console.log(`▶ 索引 ${DOCS.length} 份文档...`);
  for (let i = 0; i < DOCS.length; i++) {
    const d = DOCS[i];
    process.stdout.write(`  [${i + 1}/${DOCS.length}] ${d.name} ... `);
    const chunks = await ragService.indexDocument(KB_ID, i + 1, d.content, {
      kbName: "倍轻松产品库",
      documentName: d.name,
    });
    console.log(`${chunks.length} 片`);
  }

  // 转成 runner.cjs 能用的格式
  const items = GOLDEN.map((g) => ({
    id: g.id,
    query: g.q,
    expect_doc: g.doc,
    expect_keywords: g.kw ?? [],
    type: g.type ?? "text",
  }));

  const out = path.join(__dirname, "..", "golden", "all-products.json");
  fs.writeFileSync(out, JSON.stringify(items, null, 2), "utf-8");
  console.log(`\n✅ golden 集: ${out}（${items.length} 题）`);
}

main().catch((e) => {
  console.error("seed 失败:", e);
  process.exit(1);
});
