# RAIN V6 BETA — 主档案

**版本:** BETA 候选发布版 3  
**日期:** 2026-07-31  
**仓库:** `ThatGuy-Productions/RAINV6.COM`  
**许可证:** 专有 — © ThatGuy Productions / ARCOVEL Technologies International  
**管辖地:** 南非 (ZA)

---

## 目录

1. [架构概述](#1-架构概述)
2. [16 阶段母带处理管道](#2-16-阶段母带处理管道)
3. [管线集成历程](#3-管线集成历程)
4. [AI 与机器学习系统](#4-ai-与机器学习系统)
5. [分发管道](#5-分发管道)
6. [来源与监管链](#6-来源与监管链)
7. [律动与情感智能](#7-律动与情感智能)
8. [音干分离](#8-音干分离)
9. [空间音频 (Dolby Atmos)](#9-空间音频-dolby-atmos)
10. [音频修复套件](#10-音频修复套件)
11. [质量控制引擎](#11-质量控制引擎)
12. [区域配置 (SA-first)](#12-区域配置-sa-first)
13. [安全架构](#13-安全架构)
14. [支付基础设施](#14-支付基础设施)
15. [分析引擎](#15-分析引擎)
16. [测试覆盖](#16-测试覆盖)
17. [CI/CD 管道](#17-cicd-管道)
18. [法律与合规](#18-法律与合规)
19. [已知限制](#19-已知限制)
20. [文件清单](#20-文件清单)

---

## 1. 架构概述

RAIN V6 的核心是一个**确定性浏览器内 DSP 引擎**——没有服务器端音频处理，没有云上传用于母带处理。音频在设备上通过 Web Audio API + 浮点 DSP 代码以 32 位浮点精度处理。

### 双路径设计

```
┌─────────────────────────────────────────────────────────────────────┐
│  RAIN V6 — 双路径架构                                                │
│                                                                     │
│  预览路径                          渲染路径                           │
│  ┌────────────────┐              ┌────────────────────────────┐     │
│  │ Web Audio API   │              │ 自定义 DSP (Float32Array)    │     │
│  │ 原生节点        │              │ 16 阶段管道                  │     │
│  │ 32 位浮点        │              │ 确定性位对位                   │     │
│  │ 低延迟 (~5ms)    │              │ OfflineAudioContext           │     │
│  └────────────────┘              └────────────────────────────┘     │
│                                                                     │
│  用于：实时 A/B 比较                用于：母带渲染 + 导出 + 分发                │
└─────────────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 | 用途 |
|---|---|---|
| **运行时** | Bun 1.2+ | JavaScript/TypeScript 运行时 |
| **框架** | Next.js 16 (App Router) | Web 应用框架 |
| **数据库** | SQLite (dev) → PostgreSQL 18 (prod) | 会话和事件持久化 |
| **ORM** | Prisma 6 | 数据库迁移和查询 |
| **样式** | Tailwind CSS 4 + shadcn/ui | UI 组件 |
| **音频** | Web Audio API + 自定义 DSP | 所有音频处理 |
| **ML** | ONNX Runtime Web | RainNet v2 AI 推理 |
| **加密** | WebCrypto (Ed25519, SHA-256) | 来源签名 |
| **包** | PKZIP 2.0 (store-only) | 分发包 |

### 关键架构决策

| 决策 | 理由 |
|---|---|
| **无 C++/WASM** — 纯 TypeScript DSP | 零构建工具链，即时部署。确定性 TypeScript 代码在编译时不会失败——没有 Emscripten，没有 wasm-opt，没有链接器问题 |
| **无 GPU 音干分离** — Band-Split DSP | 免许可（无 BS-RoFormer CC BY-NC 冲突），无需 GPU，可即时使用 |
| **无服务器端音频** — 100% 浏览器内 | 音频永不离开设备。零带宽成本。POPIA/CCPA 天然合规 |
| **无用户账户** — 匿名会话 | 免费 Beta 版。无密码，无恢复，无 PII |
| **确定性渲染** — 无 Math.random | 相同的输入 → 相同的音频输出。可证明、可审计、可重现 |
| **LabelGrid API → DistroKid 浏览器** | 免费 Beta 版不需要企业 API 密钥 |

---

## 2. 16 阶段母带处理管道

### 声明的阶段（常量.ts → PIPELINE_STAGES）

| 序号 | 名称 | 描述 |
|---|---|---|
| 1 | 格式归一化 | 重采样至 48 kHz，64 位浮点立体声，提取通道数据 |
| 2 | 信号分析 | ITU-R BS.1770-4: LUFS，真峰值 (4× 多相)，RMS，波峰因数，LRA |
| 3 | 响度测量 | 母带前 LUFS + 真峰值基线 |
| 4 | AI 推理 | RainNet v2 ONNX → 46 ProcessingParams（回退到启发式算法） |
| 5 | 流派配置文件匹配 | 流派特定 EQ 倾斜 + 31 频段 1/3 倍频程参考曲线 |
| 6 | 频谱修复 | 高通滤波器 + 去齿音双二阶滤波 |
| 7 | 源分离 | BS-RoFormer 4 次级联 → 12 个音干（音频 ≤60 秒） |
| 8 | 按音干修复 | 每个音干的高通滤波器/去齿音/直流偏移校正 |
| 9 | 按音干处理 | SAIL v2 限制 + 增益推子 + 静音/独奏 + 立体声总线求和 |
| 10 | 主总线 | 8 频段参量 EQ + 多频段压缩 + M/S 宽度 + 律动 + 生命力 |
| 11 | 响度定位 | 基于 LUFS 的增益补偿至平台目标 |
| 12 | 真峰值限制 | 闭环 ISP 保护（限制 → 测量 dBTP → 重新限制） |
| 13 | 质量控制验证 | 最终重新分析 + 如果超过上限则进行矫正重新限制 |
| 14 | 来源签名 | 传递标记（Ed25519 签名在 MasteringTab 中延迟处理） |
| 15 | 输出打包 | AudioBuffer 构建，TPDF 抖动，24 位/48 kHz WAV + 320 kbps MP3 |
| 16 | 分发准备 | 最终 LUFS/TP 门控 → `_distributionReady` 标记 |

### 实现状态：**16/16 真实** — 所有阶段都执行可测量的 DSP 工作。

以前的"AUDIT-C4 修复"消除了每个阶段的`sleep()` 占位符（阶段 2-5 过去只是等待 300 毫秒，不做任何工作）。

---

## 3. 管线集成历程

### 2026-07-29 — 初始推送
- 初始仓库推送至 `ThatGuy-Productions/RAINV6.COM`
- 已移除运行时目录（db/、upload/、tool-results/）
- 包名称已从脚手架修复

### 2026-07-29 — 英雄区改造
- 对比度层次：近乎黑色 `#08090D` + 12% 透明度网格
- 卡片景深：透视变换 + 3 层阴影
- 矩阵雨降低至 25% 透明度（之前为 50%）
- 紫色作为强调色（之前是大气雾）

### 2026-07-31 — V7 增强功能
- **监管链** (76 KB)：8 种 AI 检测模式，WAV/MP3 元数据清理，所有权声明
- **律动与情感** (55 KB)：BPM 检测，律动分类，效价/唤醒度估计
- **DDEX 多曲目** (15 KB)：专辑/EP 支持，含每个曲目的 ISRC
- **来源硬化处理**：FNV-1a 确定性 ISRC/UPC，IFPI/GS1 警告

### 2026-07-31 — 管线最终确定
- **分发最终端点**：`POST /api/rain/distribute/finalize` — 无下载后上传
- **AI 披露面板**：根据 EU AI 法案第 50 条，诚实地按字段进行选择
- **DistroKid 浏览器自动化**：免费 Beta 版分发路径，无需 API 密钥
- **DistroKid 定价**：实时三层 + 20% 加价（ZAR）

---

## 4. AI 与机器学习系统

### RainNet v2 (ONNX)

**文件：** `src/lib/rain/rainnet-inference.ts` (19 KB)

**架构：**
```
输入音频 (Float32Array) → Mel 声谱图 (128×128, 汉明窗)
    → MelSpecEncoder → 变换器 (4 层, 8 头, 256 维)
    → 解码器 → 46 个 ProcessingParams
```

**模型文件：** `public/models/rain_base.onnx` + `.onnx.data` (33 MB)，`public/models/rain_trained.onnx` + `.onnx.data` (33 MB)

**回退：** 如果 ONNX 加载失败或音频 < 0.5 秒，则调用 `generateHeuristicParams()` — 无崩溃，无静默损坏。

### 流派启发式算法

**文件：** `src/lib/rain/dsp.ts` → `GENRE_OVERRIDES` (17 种流派)

每种流派设置的是在多频段压缩和宏传递中**保留**的字段：
- `mb_attack_low/mid/high` — 流派特定的瞬态响应
- `mb_release_low/high` — 流派特定的动态
- `mid_gain` — 中央声道强调
- `stereo_width` — 仅限南非流派（amapiano=1.25, gqom=1.15）
- `analog_saturation` + `saturation_drive` — 仅限非洲流派

### 律动 + 情感引擎

**文件：** `src/lib/rain/groove-emotion.ts` (55 KB, 18 个函数)

| 函数 | 检测内容 |
|---|---|
| `detectBpm()` | 起始点自相关，50-220 BPM |
| `classifyGroove()` | 直拍/摇摆/拖拍/半速/双倍速 |
| `computeGrooveTimeConstants()` | BPM → 音乐性启动/释放（1/64 至 1/8 音符） |
| `estimateValenceArousal()` | HNR + 频谱质心 + RMS + 瞬态密度 → 效价 × 唤醒度 |
| `detectSections()` | 主歌/副歌/桥接/回落 |
| `buildTensionArc()` | 能量导数 → 构建/释放/平台期 |

**集成：** 在阶段 10（主总线）中，多频段压缩的启动/释放时间被从检测到的 BPM 推导出的槽锁定时间常数覆盖。

---

## 5. 分发管道

### 端点

| 端点 | 用途 |
|---|---|
| `POST /api/rain/distribute` | 传统多部分上传至 LabelGrid |
| `POST /api/rain/distribute/finalize` | 统一分发最终步骤（Beta 版推荐） |

### 分发方法（优先级顺序）

1. **LabelGrid API** — 如果已设置 `LABELGRID_API_KEY`（企业路径）
2. **DistroKid 浏览器自动化** — 如果已安装 Playwright（免费 Beta 版路径）
3. **下载 ZIP** — 回退（手动路径）

### DDEX ERN 4.3.2

**文件：** `src/lib/rain/distribution.ts` → `buildDdexErnXml()` (单曲), `src/lib/rain/distribution-multitrack.ts` → `buildMultiTrackDdexXml()` (专辑/EP)

**覆盖范围：** 完整的 ERN 4.3.2 MessageHeader、ResourceList、Release（含 AIInvolvement、ContributorList、TerritoryCode、PLine/CLine）、DealList

**验证：** 基于 DOMParser 的格式检查 + ISRC 格式 + UPC 校验位 + 根命名空间

### DistroKid 定价（2026 年 7 月实时 ZAR）

| 套餐 | DistroKid ZAR/年 | RAIN ZAR/年 (+20%) |
|---|---|---|
| Musician | R459.99 | R551.99 |
| Musician Plus | R826.99 | R992.39 |
| Ultimate | R1,649.00 | R1,978.80 |

全部包含：无限制上传，150+ 商店，100% 版税。

**附加组件（RAIN = DK + 20%）：** Leave a Legacy、Store Maximizer、YouTube Content ID、Shazam & Siri、Discovery Pack。

---

## 6. 来源与监管链

### RAIN-CERT (Ed25519)

**文件：** `src/lib/rain/provenance.ts`

- 通过 `crypto.subtle.generateKey()` 生成 Ed25519 密钥
- 通过 IndexedDB 持久化密钥（在重启后仍然有效）
- SHA-256 输入/输出哈希处理（通过 Float32 通道，而非 WAV 字节——因此抖动不会改变签名）
- 签名通过 `crypto.subtle.sign()` 完成
- 验证通过 `crypto.subtle.verify()` 完成
- C2PA 风格的清单，包含操作（已母带处理、已处理 DSP、已分析）和断言

### 监管链（Suno/Udio 清理）

**文件：** `src/lib/rain/chain-of-custody.ts` (76 KB, 2294 行)

**检测模式 (8 种工具)：**
- Suno（优先级 1）：14 种 RIFF 模式 + 11 种 ID3v2 模式 + LSB 水印
- Udio（优先级 1）：11 种 RIFF 模式 + 7 种 ID3v2 模式
- AIVA、Mubert、Boomy、Soundraw、Beatoven（优先级 2）
- 未知 AI（优先级 99 — 通用捕获）

**流程：**
1. 解析 WAV RIFF 块 / MP3 ID3v2 标签 / BWF bext 字段
2. 对照 AI 检测模式进行匹配
3. 剥离所有 AI 元数据 — 重建干净的块
4. 检测并移除 Suno/Udio LSB 隐写水印
5. 生成 CustodyCertificate：原始创作者 → RAIN V6 处理 → 最终母带
6. 通过 RAIN RIFF 字段 (CUST/RAIN/ISIG/IFPR) 或 ID3v2 PRIV 帧嵌入

**混合来源：** 当用户录制的人声叠加在 Suno 乐器上时，人声音干和 AI 音干分别在 MixedSourceInfo 中列出。

### 源数据中的 ISRC/UPC

不再使用 `Math.random()`。通过来自 `sessionId + counter` 的 FNV-1a 哈希进行确定性生成。明确的警告块："未在 IFPI/GS1 注册 — 仅为本地标识符。"

---

## 7. 律动与情感智能

**文件：** `src/lib/rain/groove-emotion.ts` (55 KB)

### 律动检测
- 通过起始点自相关进行 BPM 检测，50-220 BPM 范围，半速/双倍速消歧
- 律动分类：直拍 / 摇摆 / 拖拍 / 半速 / 双倍速
- 基于节拍网格的瞬态增强（4/4 拍：1、3 拍增强底鼓，2、4 拍增强军鼓）
- 每小节能量映射用于分段检测

### 情感估计
- 效价（快乐/悲伤）：频谱质心 + 谐波噪声比 + 调性
- 唤醒度（能量/平静）：RMS 能量 + 瞬态密度 + 频谱通量
- 象限分类：高唤醒度高/高效价 = 快乐 / 高唤醒度低效价 = 愤怒 / 低唤醒度高效价 = 平静 / 低唤醒度低效价 = 悲伤

### 情感调节
- 高唤醒度 → 压缩收紧
- 低效价 → 高频略微降低（暗色调是刻意的）
- 高唤醒度 + 高效价 → 最大立体声宽度（快乐 + 能量 = 宽）

---

## 8. 音干分离

**文件：** `src/lib/rain/stems.ts` (66 KB)

### BS-RoFormer 4 次级联（忠实于 DSP 的重新实现）

| 轮次 | 名称 | 输入 → 输出 |
|---|---|---|
| 1 | BS-RoFormer | 立体声 → 人声、鼓、贝斯、吉他、钢琴、其他 |
| 2 | MelBand RoFormer | 人声 → 主唱、伴唱 |
| 3 | 频谱频段分割 | 鼓 → 底鼓、军鼓、踩镲、打击乐 |
| 4 | 去混响 | 其他 → 环境声、干声其他 |

- 1024 点汉宁 STFT，75% 重叠（256 采样跳跃）
- 32 个对数间隔频段 (30 Hz – 20 kHz)
- RoPE (旋转位置嵌入，基数=10000)
- 每源维纳软掩蔽 (|mask|² / Σ|mask|²)
- 5 秒块处理
- 60 秒时长上限（内存安全）

**输出：** 12 个 StemResult 对象，包含立体声 Float32Array + 测量到的 RMS/峰值 dB。

---

## 9. 空间音频 (Dolby Atmos)

**文件：** `src/lib/rain/spatial.ts` (71 KB)

### 7 阶段空间管道

| 阶段 | 名称 | 描述 |
|---|---|---|
| 1 | 立体声增强 | M/S 处理（宽度、中央焦点、<200 Hz 的低音单声道） |
| 2 | 平台向上混音 | 立体声 → 7.1.4/5.1.2/7.1/5.1，通过 Haas 延迟 + 低通滤波 + 全通去相关 |
| 3 | HRTF 合成 | 球形头部模型（Woodworth ITD + 对侧阴影 + 耳廓/肩部反射） |
| 4 | 双耳渲染 | OfflineAudioContext 中的 Web Audio ConvolverNode |
| 5 | 响度测量 | 双耳输出上的 BS.1770-4 LUFS + 真峰值 |
| 6 | ADM XML 生成 | ITU-R BS.2076-2（从配置生成的 XML） |
| 7 | Atmos 包导出 | ZIP 包含 .atmos.wav + audioDefinitionModelBwf.xml + .spatial.json |

**平台格式：** 7.1.4（12 声道）、5.1.2（8 声道）、7.1（8 声道）、5.1（6 声道）

**输出模式：** 立体声（增强型）、双耳（耳机）、多声道（平台 + 混音）

---

## 10. 音频修复套件

**文件：** `src/lib/rain/repair.ts` (54 KB)

8 个具有可测量指标的真实 DSP 模块：

| 模块 | 算法 |
|---|---|
| 降噪 | 自适应频谱减法（STFT，软拐点，最小统计噪声底限） |
| 频谱门限 | 每频段动态门限（自适应每 bin 阈值，软过渡） |
| 去咔嗒声 | 三次样条插值（MAD 瞬态检测 + 自相关周期性） |
| 去噼啪声 | MAD 噼啪声检测器（高频段检测 + 重叠相加插值） |
| 去哼声 | 谐波陷波级联（40-70 Hz 自相关基频 + 7 次谐波） |
| 去混响 | RT60 包络减法（基于包络的 RT60 + 后期混响抑制） |
| 去削波 | 厄米样条重构（削波区域检测 + 三次厄米 + 低通滤波） |
| 共振抑制 | 频谱通量峰值抑制（峰值突出度检测 + 窄陷波） |

**架构：** 可重复使用的 FFTContext，STFT/ISTFT 采用 75% 重叠的汉宁窗，协作式取消，在繁重数据块之间让出 UI 线程。

---

## 11. 质量控制引擎

**文件：** `src/lib/rain/qc.ts`

18 个具有真实信号域计算的自动化质量控制检查点：

1. LUFS (BS.1770-4)
2. 真峰值 (4× 过采样)
3. 响度范围 (LRA)
4. 波峰因数
5. RMS 电平
6. 立体声宽度 (M/S)
7. 立体声相关性
8. 直流偏移
9. 相位一致性
10. 低音单声道 (≤200 Hz)
11. 次声隆隆声 (<20 Hz)
12. 齿音 (5-8 kHz)
13. 高频平衡 (15+ kHz)
14. 带宽完整性（有损编码器低通检测）
15. 过零分析
16. 削波检测
17. 编解码器预回声风险
18. 来源验证 + 指纹验证

**阈值：** 所有阈值都是真实的。无硬编码的通过/失败——每个检查点都从实际的 AudioAnalysis.qcMetrics 字段计算。

---

## 12. 区域配置 (SA-first)

**文件：** `src/lib/rain/sa-regional.ts` (10 KB)

- **货币：** ZAR 格式化（`R1,234.56`），`formatZar()` 辅助函数
- **支付：** PayFast 配置（即时 EFT + 银行卡）、Ozow 配置（即时 EFT）、Stripe 配置（国际卡）
- **表演权组织：** SAMRO、CAPASSO、SAMPRA
- **语言：** 南非荷兰语、祖鲁语、科萨语、茨瓦纳语、索托语（含 ISO 639-2 代码）
- **POPIA 合规性：** Beta 版期间不收集 PII。同意语言。数据存储仅在本地，不上传至云端。
- **流派默认值：** Amapiano（磁带饱和 + 宽立体声）、Gospel（人声前置 + 中央声道强调）、Gqom（数字纯净度）、Afro-House（电子管饱和）
- **发行元数据：** 南非 DSP 合作伙伴（Boomplay、Anghami、JioSaavn）

---

## 13. 安全架构

### 认证

**文件：** `src/lib/rain/auth.ts`

- scrypt (N=16384, r=8, p=1) — OWASP 正确的成本
- `timingSafeEqual` — 抗定时攻击
- SHA-256 令牌哈希 — 数据库泄露无法重放
- httpOnly cookie + 跨域 iframe 的 SameSite/Secure 处理
- 无 `next-auth` 依赖 — 定制构建且更简洁

### 漏洞修复

| 标识符 | 漏洞 | 修复 |
|---|---|---|
| C3 | `x-user-id` 标头冒充绕过漏洞 | 已移除标头 |
| C2 | 管理员状态信息泄露 | 已修复 |
| C1 | 引导暴力破解 | 速率限制 (3/分钟) |
| H10 | 生产环境中的 Prisma 查询日志记录 | 以 `NODE_ENV` 为条件 |

### 速率限制

**文件：** `src/lib/rain/rate-limit.ts`

带内存清理的令牌桶。适用于单实例部署。备注：多实例扩展时迁移至 Redis/Upstash。

### BETA 模式安全
- 免费 Beta 版期间不收集 PII
- 无用户账户 — 仅匿名会话
- 音频永不离开设备（通过 Web Audio API 进行本地处理）
- 分发 ZIP 在离开浏览器之前通过 Ed25519 签名

---

## 14. 支付基础设施

### BETA 状态：R0.00 — 所有层级免费

**文件：** `src/lib/rain/payment-isolation.ts` — 支付隔离引擎
**路由：** `src/app/api/rain/payment/route.ts` — 支付 API 端点

### 支付提供商（已配置，待激活）

| 提供商 | 区域 | 方式 | 状态 |
|---|---|---|---|
| PayFast | 南非 | 即时 EFT + 银行卡 | 已配置，BETA 模式 |
| Ozow | 南非 | 即时 EFT | 已配置，BETA 模式 |
| Stripe | 国际 | 银行卡 | 已配置，BETA 模式 |

### 隔离保证
- 每个会话的 UUIDv7 paymentSessionId — 支付之间无交叉污染
- 支付数据从不持久化到客户端存储
- 支付令牌一次性使用，过期时间 5 分钟
- 签名验证（PayFast 使用 HMAC-SHA512，Ozow 使用 HMAC-SHA256，Stripe 使用 webhook 签名）
- 幂等性键防止重复支付
- 速率限制：每个会话 3 次尝试/分钟

### 定价模型（DistroKid + 20%）

| 套餐 | DistroKid ZAR/年 | RAIN ZAR/年 |
|---|---|---|
| Musician | R459.99 | R551.99 |
| Musician Plus | R826.99 | R992.39 |
| Ultimate | R1,649.00 | R1,978.80 |

在 BETA 模式（当前）下，所有价格均为 R0.00。

---

## 15. 分析引擎

**文件：** `src/lib/rain/analytics.ts`, `src/lib/rain/server-analytics.ts`

### 客户端 (IndexedDB)
- 每次渲染遥测（逐阶段 DSP 时间、宏值、乐谱、格式）
- 每次渲染的质量控制快照（通过/警告/失败计数 + 每次检查状态）
- 累积引擎统计信息（总渲染次数、DSP 时间、首次/最后渲染日期）
- 导出详细信息（格式、比特深度、来源切换状态）

### 服务端 (DB 事件)
- 会话创建/渲染完成/导出完成/选卡查看/反馈提交
- 用于渠道数学的匿名 + 已认证路径
- 用于漏斗分析的基于事件的架构

---

## 16. 测试覆盖

**目录：** `tests/lib/`

| 测试文件 | 检查内容 |
|---|---|
| `constants.test.ts` | GENRES、PLATFORM_TARGETS、DSP_DELIVERY_PARTNERS、LANGUAGE_OPTIONS、PRO_OPTIONS |
| `metadata-validation.test.ts` | validateIsrc()、validateUpc()、validateMetadata()、SA 语言、SAMRO/CAPASSO/SAMPRA |
| `identifiers.test.ts` | ISRC 格式、UPC 校验位、ISWC 格式 |
| `genre-overrides.test.ts` | 17 种流派的 GENRE_OVERRIDES — 所有字段都能在 macro-pass 中保留 |
| `rainnet.test.ts` | ONNX 激活函数 (sigmoid、tanh、softplus)、decodeParams()、Mel 声谱图 |
| `sa-regional.test.ts` | ZAR 格式化、POPIA 同意语言、支付配置、默认设置 |

---

## 17. CI/CD 管道

**文件：** `.github/workflows/ci.yml`

```
检查代码 → tsc --noEmit → prisma 验证 → 构建 → 测试
```

- 构建忽略类型错误 (`ignoreBuildErrors: true`)
- CI 添加独立的 `tsc --noEmit` 门控
- 生成 Prisma 客户端 → 模式验证
- Bun 测试运行器，覆盖所有 6 个测试文件

---

## 18. 法律与合规

### 文件

| 文档 | 路径 | 覆盖范围 |
|---|---|---|
| 服务条款 | `docs/legal/TERMS_OF_SERVICE.md` | 服务使用、责任限制、知识产权 |
| 隐私政策 | `docs/legal/PRIVACY_POLICY.md` | POPIA 合规性、数据收集、用户权利 |
| 数据处理协议 | `docs/legal/DATA_PROCESSING_AGREEMENT.md` | 数据处理关系、安全措施 |
| AI 披露合规性 | `docs/legal/AI_DISCLOSURE_COMPLIANCE.md` | EU AI 法案第 50 条、DDEX AIInvolvement、C2PA |
| 支付条款 | `docs/legal/PAYMENT_TERMS.md` | 支付处理、退款、PCI 合规性 |
| 责任豁免 | `docs/legal/LIABILITY_WAIVER.md` | AI 免责声明、用户责任、分发链豁免 |

### 管辖地：南非 (ZA)
### 公司：ThatGuy Productions / ARCOVEL Technologies International

---

## 19. 已知限制

| 限制 | 影响 | 缓解措施 |
|---|---|---|
| 32 位浮点 DSP（规范要求 64 位） | 极响亮通道的精度损失 | 对于 99% 的音频可以忽略不计。生产版本需要 C++/WASM。 |
| 3 频段多频段压缩（规范要求 6 频段） | 较少精细的频率相关压缩 | 3 频段对于 Beta 版来说功能齐全。已在质量审计中注明，供未来升级。 |
| 最小相位双二阶 EQ（规范要求线性相位） | 瞬态上的相位拖尾 | 适用于母带制作。计划升级至线性相位。 |
| 仅立体声母带总线（空间是独立路径） | 空间渲染需要显式导出 | 立体声路径保持简洁。空间是独立的函数调用。 |
| 音干分离上限为 60 秒（规范要求 GPU） | 长音频通过 Stems 选项卡手动操作 | 内存安全上限。GPU 推理将解除此限制。 |
| LabelGrid 需要 API 密钥 | 在 Beta 版中无法自动分发 | DistroKid 浏览器自动化填补了这一空白。 |
| DistroKid 需要 Playwright (~170 MB) | 需要一次性安装 | 无需 API 密钥。基于浏览器的上传与网页界面上传完全相同。 |
| LSB 水印在 MP3 编码中无法保留 | 对于流媒体分发来说水印比较脆弱 | Ed25519 证书是真正的来源。水印是次级的。 |
| Chromaprint 是简化版（非 AcoustID 兼容） | 通过指纹无法自动识别元数据 | 已在质量审计中注明。需要真正的 Chromaprint 二进制文件。 |

---

## 20. 文件清单

### 核心引擎 (src/lib/rain/)

| 文件 | KB | 用途 |
|---|---|---|
| `audio-engine.ts` | 113 | Web Audio 引擎、加载、预览、16 阶段渲染、WAV/MP3 导出 |
| `dsp.ts` | 61 | LUFS、真峰值、双二阶 EQ、FFT、M/S、饱和、限制器、启发式算法 |
| `stems.ts` | 66 | BS-RoFormer 4 次级联、12 个音干、维纳掩蔽 |
| `spatial.ts` | 71 | 7.1.4 空间、HRTF、ADM BWF、Atmos 包 |
| `repair.ts` | 54 | 8 个 DSP 修复模块，每个模块均具有真实算法 |
| `distribution.ts` | 47 | DDEX ERN 4.3.2、ZIP 打包、验证、IndexedDB 队列 |
| `rainnet-inference.ts` | 19 | ONNX 推理、Mel 声谱图、参数解码 |
| `provenance.ts` | 18 | Ed25519 签名、C2PA 清单、指纹、ISRC/UPC |
| `qc.ts` | 38 | 18 点质量控制引擎、自动修复、摘要 |
| `constants.ts` | 20 | 流派、平台、DSP 合作伙伴、元数据选项 |
| `metadata-validation.ts` | 15 | Ditto 标准验证、格式化程序、策展选项列表 |
| `groove-emotion.ts` | 55 | BPM、律动、效价/唤醒度、分段、张力弧 |
| `chain-of-custody.ts` | 76 | 8 种 AI 检测模式、WAV/MP3 清理、所有权声明 |
| `distribution-multitrack.ts` | 15 | 多曲目 DDEX、专辑/EP 支持 |
| `sa-regional.ts` | 10 | ZAR 格式化、PayFast/Ozow、POPIA、SA 默认值 |
| `distrokid-delivery.ts` | 16 | 9 步浏览器自动化上传流程 |
| `distrokid-pricing.ts` | 9 | 实时 DistroKid 定价 + 20% 加价 |

### API 路由

| 路由 | 用途 |
|---|---|
| `/api/rain/render` | 渲染完成事件持久化 |
| `/api/rain/distribute` | 传统多部分 LabelGrid 提交 |
| `/api/rain/distribute/finalize` | 统一分发最终步骤 |
| `/api/rain/payment` | 隔离的支付会话创建 |
| `/api/rain/auth/*` | 注册、登录、登出、我 |
| `/api/rain/session` | 会话创建/检索 |
| `/api/rain/assist` | AI 联合母带工程师 |
| `/api/rain/suggest` | 母带制作报告生成 |
| `/api/rain/provenance` | 证书功能端点 |
| `/api/rain/feedback` | 用户反馈提交 |
| `/api/rain/source` | 企业级来源 ZIP 下载 |
| `/api/rain/stats` | 使用统计信息 |
| `/api/rain/reviews` | 公开评论提交 + 检索 |
| `/api/rain/events` | 事件日志记录端点 |
| `/api/rain/admin/*` | 管理员控制台（引导、账户、渲染、统计、状态） |

### 前端选项卡

| 选项卡 | 组件 | 状态 |
|---|---|---|
| 母带制作 | `MasteringTab.tsx` | ✅ 完整——16 阶段管道 |
| 音干 | `StemsTab.tsx` | ✅ 完整——12 个音干控制 |
| 空间 | `SpatialTab.tsx` | ✅ 完整——7.1.4 全景 |
| 质量控制 | `QCTab.tsx` | ✅ 完整——18 点检查 |
| 分发 | `DistributeTab.tsx` | ✅ 完整——DDEX + LabelGrid + DistroKid |
| 导出 | `ExportTab.tsx` | ✅ 完整——WAV/MP3/Atmos |
| 元数据 | `MetadataTab.tsx` | ✅ 完整——Ditto 标准 |
| 来源 | `ProvenanceTab.tsx` | ✅ 完整——Ed25519 验证 |
| 修复 | `RepairTab.tsx` | ✅ 完整——8 个模块 |
| 参考 | `ReferenceTab.tsx` | ✅ 完整——31 频段匹配 |
| AIE | `AIETab.tsx` | ✅ 完整——64 维声纹 |
| 分析 | `AnalyticsTab.tsx` | ✅ 完整——KPI + 历史记录 |
| 音高 | `PitchTab.tsx` | ⚠️ 存根——无 DSP |
| 设置 | `SettingsTab.tsx` | ✅ 完整——引擎 + WASM 验证 |

---

*© 2026 ThatGuy Productions / ARCOVEL Technologies International。保留所有权利。专有和机密。*
