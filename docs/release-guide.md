# 发布与版本维护

产品版本以 `manifest.json` 为唯一来源，使用三段数字。从正式 `1.0.0` 起递增，不再重置编号。账号格式 v2、Manifest V3、接口/存储键中的 v1/v2 和 jsQR 版本是独立概念，不能批量改为产品版本。

## 历史编号

| 历史顺序 | 产品版本 | 对应提交 | 说明 |
| --- | --- | --- | --- |
| 1 | 1.6.0 | 8b7ce60 | 早期开发编号，无固定公钥 |
| 2 | 1.6.1 | 4330656 | 引入固定 ID；保留真实历史标签 |
| 3 | 0.9.0 | fe40810 | 开发编号重整，数据格式没有回退 |
| 4 | 0.10.x | 未独立发布的本地迭代 | 仅本地测试包，包含临时修复命名 |
| 5 | 1.0.0 | v1.0.0 标签对应提交 | 正式编号起点，本次补齐完整发布链路 |

原提交 `615dbae` 将源码设为 1.0.0 并推送了 main，但没有创建同版本标签或 GitHub Release，所以 README 的 latest 下载入口继续返回旧包。历史提交和附件不改名；旧 Release 标题和说明标明“历史编号”，当前正式下载通过 latest 和 README 的明确版本链接提供。

## 发布步骤

```sh
npm run version:set -- 1.0.1
# 编写 docs/releases/1.0.1.md，按变更范围运行回归。
npm run check
npm test
python tools/package-test.py
python tools/package.py
git add <本次变更的文件>
git commit -m "发布 LocalOTP 1.0.1"
git tag -a v1.0.1 -m "LocalOTP 1.0.1"
npm run release:check -- --check-tag v1.0.1
git push origin main
git push origin v1.0.1
```

`npm run version:sync` 可按当前 manifest 重新生成 package、README 及 `js/version.js`。真实插件显示运行时 manifest 版本，网页预览显示生成版本。检查会拒绝过期声明、错误包名、不同提交的标签及未提交源码；发布必须使用干净工作区。

`.github/workflows/release.yml` 检出被推送的标签，在 Linux 上检查版本、固定 ID、资源与打包守卫，生成 ZIP 和 SHA256，上传至草稿 Release，附件完整后正式发布并显式设为 latest。正式发布统一串行，并与远端正式版本比较，防止较小版本后完成导致 latest 倒退；上表的三个历史开发标签作为明确编号重整例外。可手动触发工作流并指定已有标签；已有 Release 会被拒绝，避免覆盖下载附件。旧标签名不能复用。只推送 main 不会发布。

发布后检查 Actions 成功、latest 指向对应标签，并重新下载附件，以 `python tools/package.py --verify-only <LocalOTP-当前版本.zip>` 核对内容与校验和。当前打包固定时间、权限、文件顺序和文本 LF，使用无压缩 ZIP，避免不同压缩库改变字节；本机与 CI 的包应完全一致。旧本地产物移入 `dist/archive/`，该目录不纳入 Git。

明确决定保留当前版本号补充静态资源时，可以修订同一正式版；必须保留原提交历史，并同步对齐版本标签所指提交、ZIP 与 SHA256。先确认标签的旧对象并用精确 `--force-with-lease` 更新该标签，再手动触发工作流，明确将 `refresh_existing` 设为 true。默认仍拒绝覆盖；修订仅限同标签已正式发布的版本，不能覆盖草稿、预发布或让 latest 倒退。完成后重新下载校验，不能只更改下载文件名或只替换附件。本次平台分类图标按此方式并入 1.0.0。

## 已安装的解压版

升级前保留账号备份。已采用固定 ID 的安装可以替换当前加载目录文件并重新加载；目录名不是运行时版本。不要先卸载已有数据的插件。原无 key 版本须先导出、在固定 ID 新版中导入；浏览器自动更新不将数字较小的 1.0.0 视为 1.6.x 的升级。数据格式继续保持 v2。
