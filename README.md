# Tasuki 襷

[![测试](https://github.com/silver-cx/tasuki/actions/workflows/test.yml/badge.svg)](https://github.com/silver-cx/tasuki/actions/workflows/test.yml)

> 陪你把目标一棒一棒跑完的开源跑步教练。

襷（たすき）是箱根驿传里一棒传一棒的接力带。

我是因为箱根驿传和《强风吹拂》爱上跑步的。跑了几个月才发现，自己一直在追配速，每次心率都爆表，这其实不是正确的进步方式。如果当时有个工具在第一次心率过高时就提醒我、告诉我为什么，我能少走很多弯路。

所以 Tasuki 不只记录你跑了什么，而是帮你完成一个具体目标，比如“11 月底前 5 公里跑进 30 分钟”：

- **诊断**：用心率、配速、跑量、睡眠判断你现在的状态。
- **建议**：告诉你这周该加量还是收一收、下一次怎么跑，每条建议都写明依据。
- **知识**：数据暴露问题时，推送一张讲清原理的知识卡，内容经过人工审核。

数据默认只留在你自己的电脑上。

## 现在能做什么

读取 Apple 健康数据，存进本地数据库，在命令行里输出心率区间分析和训练建议：

```text
最近 14 天的跑步（按平均心率归入区间）
  日期   距离      配速   平均心率  区间
  10/10  5.01 km   7:01   164       4 区 乳酸阈（87%）
  ...
建议
  ⚠ 轻松跑心率偏高
    发现：最近 14 天 5 次带心率的跑步里，4 次平均心率超过最大心率的 80%……
    建议：下一次轻松跑把心率上限设在 132 左右（2 区上限）……
```

## 快速开始

需要：

- 一台 Mac，安装 Node.js 22.18 或更高版本（`node --version` 查看）。
- iPhone 上安装 [MetricBridge](https://healthexport.dev)，开启导出到 iCloud。

然后在终端运行：

```bash
cd tasuki
npm run report
```

`report` 会先同步 MetricBridge 的最新数据，再输出报告。数据保存在 `data/tasuki.db`，只在你的电脑上。

### 补全历史数据（推荐做一次）

MetricBridge 只带有近期运动的心率。想让分析覆盖全部历史，导入一次健康 App 的官方导出包：

1. iPhone 打开「健康」App → 右上角头像 →「导出所有健康数据」。
2. 把生成的 `导出.zip`（英文系统叫 `export.zip`）传到 Mac，不用解压。
3. 运行：

```bash
npm run import -- ~/Downloads/导出.zip
```

同一次跑步同时出现在两个来源时，会自动合并成一条，互相补全缺失的字段。重复导入也不会产生重复记录。

### 设定目标

```bash
npm run goal -- set --distance 5 --time 30:00 --by 2026-11-30
```

之后每次 `npm run report`，第一部分就是目标进度：当前水平、还差多少、按最近的进步速度预计哪天达成。赶不上时会给出两个选择：调整训练，或调整目标。

`--distance` 填公里数，也可以填 `半马`、`全马`。查看当前目标用 `npm run goal`，取消用 `npm run goal -- clear`。

### 训练计划

设定目标时会自动生成一份到截止日的训练计划：

```bash
npm run plan                        # 重新生成并查看计划（从明天开始）
npm run plan -- show                # 只查看
npm run plan -- --weekdays 2,4,6    # 改成每周二、四、六跑（1 = 周一 … 7 = 周日）
```

计划是怎么排的：

- **每 3 周一次全力测试跑**，从截止日往前排：最后一次就是冲击目标，第一次用来测出真实的起点。有了测试成绩，目标进度就不再依赖训练跑的估算。
- **训练周**：1 次质量课（间歇跑和节奏跑交替）+ 1 次长距离慢跑 + 轻松跑。轻松跑和长距离有心率上限，质量课有目标配速。
- **跑量**每周增加约 10%，测试周和最后一周减量。任何一周都不超过前 4 周平均的 1.25 倍；跑量还不够分的时候，多选的跑步日会先空着，随着跑量上来再逐步加进来。
- **测试周**最多跑 3 次，测试前一天休息。
- 你跑完之后，报告会自动把实际跑步对上计划里的课（✓ 完成 / ✗ 未完成），并把质量课从“轻松跑心率偏高”的判断中排除。
- 每次测试后运行 `npm run plan`，后面的配速和跑量会按新成绩更新。

这是一套简单、可解释的规则模板，不是个性化的教练处方。身体不适时请休息或咨询专业人士。

### 常用参数

```bash
npm run report -- --days 28        # 看最近 28 天
npm run report -- --hrmax 186      # 手动指定最大心率
npm run report -- --no-sync        # 不同步，直接看数据库里已有的数据
npm run sync                       # 只同步 MetricBridge
```

### 没有 Apple Watch？用样例数据体验

```bash
npm run import -- fixtures/apple-export-sample --db data/demo.db
npm run goal -- set --distance 5 --time 30:00 --by 2026-11-30 --db data/demo.db --now 2026-09-20
npm run report -- --db data/demo.db --data fixtures/metricbridge-sample --now 2026-10-01
```

## 项目结构

```text
packages/
  schema/                    统一数据模型，所有数据源都转换成这个格式
  adapters/
    apple-metricbridge/      读取 MetricBridge 写到 iCloud 的数据
    apple-export/            读取健康 App 官方导出包
  store/                     本地数据库（SQLite），跨来源合并
  engine/
    metrics/                 心率区间、成绩换算、跑量
    goals/                   目标进度与达成预测
    plan/                    训练计划生成，以及实际跑步与计划的匹配
    rules/                   教练规则，一条规则一个文件，每条都有测试
  knowledge/cards/           知识卡（Markdown），需人工审核后才算正式内容
apps/cli/                    命令行入口
fixtures/                    虚构的样例数据
tests/                       测试（npm test）
```

## 路线图

- [x] 里程碑 1：读取 MetricBridge 数据，心率区间分析，第一条规则和知识卡
- [x] 里程碑 2：本地数据库，导入健康 App 官方导出包补全历史
- [x] 里程碑 3：目标设置与达成预测（5 km 成绩趋势），跑量增长提醒
- [x] 里程碑 4：训练计划（定期测试跑、质量课识别、完成情况）
- [ ] 里程碑 5：私人网页看板
- [ ] 里程碑 6：后台自动同步，更多规则和知识卡
- [ ] 之后：公开汇总页、Strava / Garmin 等数据源

## 说明

Tasuki 提供的是训练参考，不是医疗建议。心率区间是按公式估算的，个体差异很大，身体不适时请咨询专业人士。

## 许可证

[MIT](LICENSE)
