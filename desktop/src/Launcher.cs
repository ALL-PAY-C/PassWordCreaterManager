using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Program
{
    internal static ZipArchive Zip;
    internal static readonly Dictionary<string, ZipArchiveEntry> Map = new Dictionary<string, ZipArchiveEntry>();
    public static string BaseDir;
    public static string LogPath;
    static readonly object LogLock = new object();

    [STAThread]
    static int Main(string[] args)
    {
        BaseDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        LogPath = Path.Combine(BaseDir, "launcher.log");
        try { File.WriteAllText(LogPath, ""); } catch { }
        try { Directory.SetCurrentDirectory(BaseDir); } catch { }
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += delegate(object s2, ThreadExceptionEventArgs te) { Log("uithread " + te.Exception); };
        AppDomain.CurrentDomain.UnhandledException += delegate(object s2, UnhandledExceptionEventArgs ue) { Log("unhandled " + ue.ExceptionObject); };
        Log("start dir=" + BaseDir);
        try
        {
            LoadZip();
            Log("zip entries=" + Map.Count);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
            return 0;
        }
        catch (Exception ex)
        {
            Log("fatal " + ex);
            MessageBox.Show("启动失败：" + ex.Message, "PassWordCreaterManager");
            return 1;
        }
    }

    internal static void Log(string msg)
    {
        try
        {
            lock (LogLock)
                File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss") + " " + msg + "\r\n");
        }
        catch { }
    }

    static void LoadZip()
    {
        Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("web.zip");
        if (s == null) throw new Exception("web.zip resource missing");
        Zip = new ZipArchive(s, ZipArchiveMode.Read);
        foreach (ZipArchiveEntry e in Zip.Entries)
        {
            string n = e.FullName.Replace('\\', '/');
            if (n.EndsWith("/")) continue;
            Map[n] = e;
        }
    }

    internal static ZipArchiveEntry Find(string path)
    {
        string p = path;
        int q = p.IndexOf('?');
        if (q >= 0) p = p.Substring(0, q);
        p = p.TrimStart('/');
        if (p.Length == 0) p = "index.html";
        ZipArchiveEntry hit;
        if (Map.TryGetValue(p, out hit)) return hit;
        return null;
    }

    internal static string Mime(string path)
    {
        string p = path.ToLowerInvariant();
        if (p.EndsWith(".html")) return "text/html; charset=utf-8";
        if (p.EndsWith(".js")) return "text/javascript; charset=utf-8";
        if (p.EndsWith(".css")) return "text/css; charset=utf-8";
        if (p.EndsWith(".json")) return "application/json; charset=utf-8";
        if (p.EndsWith(".svg")) return "image/svg+xml";
        if (p.EndsWith(".png")) return "image/png";
        if (p.EndsWith(".jpg") || p.EndsWith(".jpeg")) return "image/jpeg";
        if (p.EndsWith(".webp")) return "image/webp";
        if (p.EndsWith(".ico")) return "image/x-icon";
        if (p.EndsWith(".woff2")) return "font/woff2";
        if (p.EndsWith(".woff")) return "font/woff";
        if (p.EndsWith(".ttf")) return "font/ttf";
        if (p.EndsWith(".map")) return "application/json; charset=utf-8";
        return "application/octet-stream";
    }
}

class MainForm : Form
{
    readonly WebView2 wv;
    CoreWebView2Environment env;

    public MainForm()
    {
        Text = "PassWordCreaterManager";
        ClientSize = new Size(1280, 800);
        MinimumSize = new Size(900, 620);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(254, 247, 255);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        wv = new WebView2();
        wv.Dock = DockStyle.Fill;
        wv.DefaultBackgroundColor = Color.FromArgb(254, 247, 255);
        Controls.Add(wv);

        Program.Log("form constructed");
        Shown += async (object s, EventArgs e) =>
        {
            Program.Log("shown fired");
            try
            {
                string dataDir = Path.Combine(Program.BaseDir, "webview2data");
                Directory.CreateDirectory(dataDir);
                string extraArgs = "";
#if DEBUG_CDP
                extraArgs = "--remote-debugging-port=9333";
#endif
                CoreWebView2EnvironmentOptions envOptions = new CoreWebView2EnvironmentOptions(extraArgs);
                env = await CoreWebView2Environment.CreateAsync(null, dataDir, envOptions);
                Program.Log("env ready");
                await wv.EnsureCoreWebView2Async(env);
                Program.Log("core ready");
                CoreWebView2Settings st = wv.CoreWebView2.Settings;
#if DEBUG_CDP
                st.AreDevToolsEnabled = true;
#endif
                st.IsStatusBarEnabled = false;
                st.AreDefaultContextMenusEnabled = false;
                st.IsPasswordAutosaveEnabled = false;
                st.IsGeneralAutofillEnabled = false;
                wv.CoreWebView2.AddWebResourceRequestedFilter("https://app.local/*", CoreWebView2WebResourceContext.All);
                wv.CoreWebView2.WebResourceRequested += OnWebResource;
                wv.CoreWebView2.DownloadStarting += OnDownloadStarting;
                wv.CoreWebView2.WebMessageReceived += OnWebMessage;
                wv.Source = new Uri("https://app.local/index.html");
                Program.Log("webview navigated app.local");
            }
            catch (Exception ex)
            {
                Program.Log("webview failed " + ex);
                MessageBox.Show("WebView2 初始化失败：" + ex.Message, "PassWordCreaterManager");
            }
        };
    }

    void OnWebResource(object sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        try
        {
            Uri u = new Uri(e.Request.Uri);
            string path = u.AbsolutePath;
            ZipArchiveEntry entry = Program.Find(path);
            if (entry == null)
            {
                MemoryStream nf = new MemoryStream(Encoding.UTF8.GetBytes("not found"));
                e.Response = env.CreateWebResourceResponse(nf, 404, "Not Found", "Content-Type: text/plain; charset=utf-8");
                return;
            }
            MemoryStream buf = new MemoryStream();
            using (Stream es = entry.Open()) es.CopyTo(buf);
            buf.Position = 0;
            string headers = "Content-Type: " + Program.Mime(entry.FullName) + "\r\nCache-Control: no-store";
            e.Response = env.CreateWebResourceResponse(buf, 200, "OK", headers);
        }
        catch (Exception ex)
        {
            Program.Log("res err " + ex.Message);
        }
    }

    static string Unique(string dir, string name)
    {
        string full = Path.Combine(dir, name);
        string stem = Path.GetFileNameWithoutExtension(name);
        string ext = Path.GetExtension(name);
        int i = 1;
        while (File.Exists(full))
        {
            full = Path.Combine(dir, stem + "-" + i + ext);
            i++;
        }
        return full;
    }

    void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string msg = null;
        try { msg = e.TryGetWebMessageAsString(); } catch { }
        if (string.IsNullOrEmpty(msg) || !msg.StartsWith("SAVE:")) return;
        try
        {
            int nl = msg.IndexOf('\n');
            string name = msg.Substring(5, nl - 5).Trim();
            string body = msg.Substring(nl + 1);
            if (name.Length == 0) name = "PassWordCreaterManager-backup.json";
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            string full = null;
            try
            {
                Directory.CreateDirectory(dir);
                full = Unique(dir, name);
                File.WriteAllText(full, body, new UTF8Encoding(false));
            }
            catch (Exception)
            {
                dir = Path.Combine(Program.BaseDir, "备份");
                Directory.CreateDirectory(dir);
                full = Unique(dir, name);
                File.WriteAllText(full, body, new UTF8Encoding(false));
            }
            Program.Log("saved " + full);
            wv.CoreWebView2.PostWebMessageAsString("SAVED:" + full);
        }
        catch (Exception ex)
        {
            Program.Log("save failed " + ex);
            wv.CoreWebView2.PostWebMessageAsString("ERR:" + ex.Message);
        }
    }

    void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
    {
        try
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            Directory.CreateDirectory(dir);
            string name = Path.GetFileName(e.ResultFilePath);
            if (string.IsNullOrEmpty(name)) name = "PassWordCreaterManager-backup.json";
            e.ResultFilePath = Path.Combine(dir, name);
            e.Handled = true;
            Program.Log("download -> " + e.ResultFilePath);
        }
        catch (Exception ex)
        {
            Program.Log("download err " + ex.Message);
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        base.OnFormClosed(e);
        Environment.Exit(0);
    }
}