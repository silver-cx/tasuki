# Tasuki 襷

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
    metrics/                 心率区间等指标计算
    rules/                   教练规则，一条规则一个文件，每条都有测试
  knowledge/cards/           知识卡（Markdown），需人工审核后才算正式内容
apps/cli/                    命令行入口
fixtures/                    虚构的样例数据
tests/                       测试（npm test）
```

## 路线图

- [x] 里程碑 1：读取 MetricBridge 数据，心率区间分析，第一条规则和知识卡
- [x] 里程碑 2：本地数据库，导入健康 App 官方导出包补全历史
- [ ] 里程碑 3：目标设置与达成预测（5 km 成绩趋势）
- [ ] 里程碑 4：私人网页看板
- [ ] 里程碑 5：后台自动同步，更多规则和知识卡
- [ ] 之后：公开汇总页、Strava / Garmin 等数据源

## 说明

Tasuki 提供的是训练参考，不是医疗建议。心率区间是按公式估算的，个体差异很大，身体不适时请咨询专业人士。

## 许可证

[MIT](LICENSE)
