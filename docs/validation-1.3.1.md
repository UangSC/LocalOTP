# 1.3.1 下拉菜单验收

日期：2026-10-29。

- 账号分类从原生 select 改为自定义 combobox / listbox，具有分类图标、选中勾、紫色高亮、浮层材质与展开动画。
- 支持方向键、Home/End、Enter、Esc、Tab 和文字前缀定位；焦点保留在触发器，Esc 先关闭菜单。
- 选项面板独立于抽屉滚动内容定位；自动向上/向下展开，长列表滚动；关闭抽屉、对话框切换、外部点击和焦点离开时清理。
- 排序与更多操作菜单同步统一视觉材质。

验证：`node tools/select-test.mjs` 18 项通过；`node tools/qa.mjs` 82 项通过；无页面异常，相关 JavaScript 语法检查通过。测试仅使用隔离浏览器和演示数据。

截图：`shots/26-select-light.png`、`27-select-dark.png`、`28-select-popup.png`；并排验收图 `29-select-review.png`。

Git 已在项目目录初始化为 main，origin 配置为 `git@github.com:UangSC/LocalOTP.git`。按用户要求仅做本地关联，尚未暂存、提交或 push，也未验证远端 SSH 连接。现有 README 保留，不执行示例中的覆盖式初始化。
