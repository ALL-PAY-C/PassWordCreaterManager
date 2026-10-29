# PassWordCreaterManager

用两份保存在本机的信息，确定性地推导出各站点密码。全程离线，支持 Windows 与 Android。

**其他语言**：[English](README.en.md)

## 项目缘起

起因是一件琐碎的麻烦：密码总是记不住，每次换设备、换账号都要重置一遍。写成清单会有复用与复制粘贴的问题，凭记忆维护几个强密码也不可靠。

确定性派生用一个机制解决了这两件事，于是这个工具被写出来供自己使用：需要密码时打开，读出推导结果，关掉。

优先级由「省事」决定。开发过程中没有在加固上投入精力，因此没有安全芯片集成、没有内存清零规范、没有对已被控制主机的防护，也没有任何审计。若使用场景包含敌对的本地环境，应当换用别的工具。

## 状态

个人项目，出于学习与自用而写。定位是确定性离线派生的一个实现示例，随之而来的限制照旧：单人维护、没有支持渠道、没有外部审计。

全部计算发生在设备本地。遥测、统计、远程日志、同步、服务端组件在结构上都不存在。

派生参数在版本 2 冻结。任何改动都会改变程序产出过的每一个密码，因此它们作为常量存在。

## 工作方式

两层秘密共同喂入密钥派生函数。可以重建派生密码的内容一律不落盘，密码按需重新计算。

第一层属于程序本身：一个账号名与一个主密码，仅保存在设备上。

第二层属于单条记录：站点上使用的账号名，以及一个本来就会被复用的简单密码，例如 `github-2019`。

两层合成为盐值，经 PBKDF2 拉伸，再展开成字节流，从中按固定字符集选取字符。

### 派生流程

输入：`appName`、`appPassword`、`site`、`simple`、`length`、`counter`、`symbols`。

1. 归一化：`norm(x) = trim(x).toLowerCase()`。
2. 盐值：`"pwvault:v2" + "|" + norm(appName) + "|" + norm(site) + "|" + simple`。
3. 密钥：`PBKDF2-HMAC-SHA256(appPassword, salt, 100000 次迭代, 32 字节)`。
4. 字节流：`HMAC-SHA256(key, norm(site) + ":" + counter + ":" + block)`，`block = 0, 1, 2, ...` 依次拼接，直到字节数量足够。整个算法只有这一处随机性来源。
5. 取字：字节映射到 `lower + upper + digits + symbols`，采用拒绝采样，跳过任何 `>= 256 - (256 % pool.length)` 的字节。符号集为 `!@#$%^&*()-_=+[]{}:,.<>?/`。
6. 类保证：结果中至少包含一个来自各启用字符类的字符。
7. 排序：使用同一字节流做 Fisher-Yates 洗牌。
8. 长度：限制在 `8..64`。序号是每条记录的整数，递增一次即为同一站点得到一套互不相关的密码。

输出即该站点注册时使用的字符串。

### 测试向量

公共输入：程序账号 `allpay`、程序密码 `123456`、站点账号 `ABC`、简单密码 `github-abc`。

| 长度 | 序号 | 符号 | 期望输出 |
| --- | --- | --- | --- |
| 16 | 1 | 是 | `?XtHrM3>1As%iPT*` |
| 24 | 1 | 否 | `TGstXqMWTIxAPH8TQiZwHTes` |
| 20 | 2 | 是 | `>%}3/:>.&U>vO#}/K^{h` |

输入经过归一化，因此 `ALLPAY` 与 ` allpay ` 推导出的密码与 `allpay` 相同。输出与本表不符的构建即为缺陷。

## 威胁模型与局限

设计要解决的是密码复用：某个站点泄露的密码，既不暴露其他站点，也不暴露两层秘密中的任何一层。

以下情形不在设计考虑之内。

- 设备被控制。在程序上下文中执行的代码可以在录入时读取主密码，也可以在产出时读取派生密码。
- 键盘记录，无论软件还是硬件。
- 主密码丢失。没有重置、没有恢复码、没有第三方托管；第一层丢失即意味着所有派生密码无法恢复。
- 被改动的构建产物。离线性质只对这份源码以及由其编译出的二进制成立；被替换的 WebView2 程序集或重新打包的 APK 可以做任何事。
- 熵极低的简单密码。第二层先天熵值很小；KDF 抬高了猜测成本，但 `1234` 不会因此变成强密码。
- 处于解锁状态的会话被他人接触。

落盘的只有输入。程序数据库一旦泄露，等同于泄露第一层与全部简单密码，与密码管理器保险库泄露的后果相当。

## 构建

依赖：Node.js 20 及以上用于网页资源；.NET Framework 4.8 与随 Windows 提供的 `csc.exe` 用于桌面宿主；JDK 17 与 Android SDK 用于安卓外壳。

### 网页

```bash
npm ci
npm run build        # 产出 dist/
```

两个原生外壳都内嵌 `dist/` 的内容。

### 桌面

```powershell
.\desktop\build.ps1
```

脚本把 `dist/` 打包为内嵌资源，将 `desktop/src/Launcher.cs` 编译为 `PassWordCreaterManager.exe`，并把 WebView2 程序集复制到同目录。Microsoft.Web.WebView2 包默认在 `%USERPROFILE%\.nuget\packages` 下查找，可用 `-WebView2Dir <lib\net462 路径>` 覆盖。

输出目录需要 `PassWordCreaterManager.exe`、`Microsoft.Web.WebView2.Core.dll`、`Microsoft.Web.WebView2.WinForms.dll`、`WebView2Loader.dll` 四个文件，缺一无法启动；系统需具备 WebView2 运行时，Windows 11 与近年 Windows 10 已自带。

### 安卓

```bash
cd android
gradlew assembleRelease        # 需设置 ANDROID_HOME 与 JAVA_HOME
```

APK 位于 `android/app/build/outputs/apk/release/`。仓库内的 `app/debug.keystore` 是抛弃式调试密钥，用途是让 release 构建无需本地配置即可跑通，不具备分发价值与安全价值。

## 实现结构

网页层：TypeScript、Vite、Material Web 组件（`@material/web`），Material 3 Expressive 样式，浅色、深色、跟随系统三种主题，五个种子色调，IndexedDB 存储。派生在页面内通过 WebCrypto 完成，原生层不参与计算。

桌面宿主：.NET Framework 4.8 的 WinForms 窗口内嵌 WebView2。页面由内嵌 zip 经虚拟主机映射到 `https://app.local` 提供。origin 固定是刻意选择：IndexedDB 按 origin 隔离，稳定的 origin 意味着本地数据库在重启与升级后仍然存在。备份经宿主桥写入「下载」目录。

安卓宿主：最小化的 `WebView` 外壳，AGP 8.13（`compileSdk 36`、`minSdk 24`）。资源经 `WebViewAssetLoader` 在 `https://appassets.androidplatform.net` 提供，名为 `pvb` 的 JavaScript 桥负责把备份写入公共「下载」集合。

## 使用方式

首次启动：创建程序账号，包含一个名称与不少于八位的主密码。锁屏以 chip 列出已有账号，并校验对应的主密码。记住选项会保存该选择，后续启动直接进入保险库；锁定则回到锁屏。

新增记录：备注、站点或服务、可选网址、简单密码。派生密码立即出现，默认掩码。显示控件可解除掩码，复制控件在掩码状态下同样可用。滑条设定长度，开关控制符号类，序号字段为同一站点产出互不相关的密码，这就是轮换手段。

查找记录：搜索框按备注、站点、账号、网址过滤。`Ctrl+K` 聚焦搜索框，`Ctrl+N` 新建记录。

备份：菜单可导出 JSON 文件、从文件导入、或粘贴 JSON 导入。导入按账号名合并，并丢弃重复记录。导出文件本身即凭证，需按凭证保管。

清空：菜单中的清空操作删除 IndexedDB 数据库并重新加载至首次启动状态。

## 仓库结构

```
PassWordCreaterManager/
  index.html          Vite 构建入口
  src/                TypeScript 源码：main.ts、db.ts、derive.ts、theme.ts、styles.css
  brand/              图标源文件（SVG）、位图 PNG、生成的 ICO
  desktop/            .NET Framework WinForms 宿主与 build.ps1
  android/            Gradle 工程、WebView 外壳
  docs/screenshots/   下文引用的截图
  dist/               构建产物，不入库
```

## 截图

| 锁屏 | 记录 | 深色主题 |
| --- | --- | --- |
| ![lock](docs/screenshots/lock.png) | ![entry](docs/screenshots/entry.png) | ![dark](docs/screenshots/dark.png) |

## 备份文件格式

UTF-8 JSON，两空格缩进。`accounts` 承载第一层，`entries` 承载第二层。派生密码完全不出现在文件中，由存储的输入重新计算。

```json
{
  "format": "password-creater-manager-backup",
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "accounts": [
    {
      "name": "allpay",
      "password": "主密码明文",
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "entries": [
    {
      "accountName": "allpay",
      "note": "GitHub",
      "site": "github.com",
      "url": "https://github.com",
      "password": "第二层简单密码明文",
      "length": 20,
      "counter": 1,
      "symbols": true
    }
  ]
}
```

`format` 字段在导入时校验。更早的 PwVault 构建导出的文件（`"format": "pwvault-backup"`）仍然接受。

## 数据位置

- 网页预览：浏览器配置内的 IndexedDB 数据库 `PassWordCreaterManager`。
- 桌面：可执行文件旁的 `webview2data/`，origin 为 `https://app.local`。
- 安卓：`https://appassets.androidplatform.net` 对应的 WebView 存储。

## 兼容性

已冻结的内容：盐值前缀 `pwvault:v2`、PBKDF2-HMAC-SHA256 十万次迭代与 32 字节输出、HMAC-SHA256 字节流构造、字符集及其顺序、拒绝采样、每类至少一字符规则、同一字节流驱动的 Fisher-Yates、`8..64` 长度限制。盐值前缀保留原始拼写，使更早构建推导出的密码继续有效；它是一个输入字符串，早于当前项目命名。

Windows 与 Android 共用同一份实现，输出必须逐字节一致。上文的测试向量即为校验手段。

## 许可

MIT，见 [LICENSE](LICENSE)。

## AI 生成声明

本项目由 AI 编码代理（基于 DeepSeek）依据发布者撰写的需求生成，随后由人工审阅、构建与测试。派生算法、网页界面、桌面宿主、安卓外壳均由此产出；上文测试向量由独立实现重新计算，并与两个发行构建交叉核对。源码短到可以完整通读，尤其是 `src/derive.ts`。
