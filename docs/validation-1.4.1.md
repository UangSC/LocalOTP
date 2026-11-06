# 1.4.1 主题字母头像

日期：2026-10-29。仅使用隔离 Edge 与虚构演示账号验证。

## 在线设计参考

本次读取以下公开设计系统文档，并据此调整本项目头像，而非直接引入它们的组件或依赖：

- [Radix Avatar](https://www.radix-ui.com/themes/docs/components/avatar)：soft 外观、文字 fallback 和 highContrast。借鉴柔和底色与清晰字标，仍只显示拉丁字母。
- [Radix Colors：色阶用途](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)：区分组件背景、边框、文字所使用的色阶。头像的底色、边框和字色分别定义，不能只修改一个颜色后假定对比度自然成立。
- [Atlassian：颜色](https://atlassian.design/foundations/color/)：使用设计令牌表达角色和强调程度，并为浅深色映射不同值。头像使用主题强调色角色，不以随机告警色作为身份色。

以上原则不等于本项目继承了设计系统的可访问性保证；实际对比度独立计算。

## 实现

- 删除 util.js 中固定的十组 RGB 调色板和头像的行内颜色。
- 同一服务名称经稳定哈希得到 `data-avatar-tone=0/1/2`，只区分同色系内的轻重层次。
- `color-schemes.css` 为头像背景两端、字色、描边、顶部高光和阴影定义角色令牌，全部随当前色系与明暗主题更新。
- 浅色：轻染色底、深色字标、细描边和轻投影；深色：低亮度染色底、亮字、克制高光。黑白保持灰阶。
- 保留一到两个字母、悬停轻转与复制弹跳，字重由 750 调为 650；不更改账号、分类或同步数据。
- 现有列表节点直接换色，不需要重新创建 DOM，弹窗、列表和卡片共用同一头像组件。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `node tools/avatar-test.mjs` | 52 项通过 |
| `node tools/color-test.mjs` | 52 项通过 |
| `node tools/regression.mjs` | 26 项通过，无页面异常 |
| `node tools/selftest.mjs` | 94 项通过 |

合计 224 项。覆盖五套色系 × 浅深主题、三档头像、原有节点换色、纯字母、无行内 RGB、黑白灰阶、列表／弹窗一致性，以及原有操作和锁屏回归。

在测试的头像字色与渐变背景间采样 21 个位置，最低对比度 **6.77:1**，全部超过 4.5:1。结果见 `shots/avatars/contrast.json`。该测量针对头像背景和文字色，不代表整个界面的全面无障碍审计。

## 验收

- `shots/avatars/theme-avatar-review.png`：五套浅深主题下同样三条记录的实际裁切对比。
- `shots/avatars/*-grid.png`：十种组合的管理页截图。
- `shots/avatars/green-light-list.png`、`green-light-popup.png`：列表和弹窗。

版本 1.4.1。重新加载现有扩展并重新打开管理页即可查看，不需要清空数据。
Git 保持 main / origin 已关联，未暂存、未提交、未 push。
