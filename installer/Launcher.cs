using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

class TrayApp : ApplicationContext
{
    const int PORT = 3004;
    readonly string baseDir;
    readonly string serverExe;
    readonly string logDir;
    readonly string logFile;
    Process serverProcess;
    NotifyIcon trayIcon;

    public TrayApp()
    {
        baseDir   = Path.GetDirectoryName(Application.ExecutablePath);
        serverExe = Path.Combine(baseDir, "server", "special_room-server.exe");
        logDir    = Path.Combine(baseDir, "logs");
        logFile   = Path.Combine(logDir, "server.log");

        BuildTrayIcon();
        StartServerIfNeeded();

        var t = new Thread(WaitServerThenOpenBrowser);
        t.IsBackground = true;
        t.Start();
    }

    void BuildTrayIcon()
    {
        trayIcon = new NotifyIcon();
        try { trayIcon.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
        catch { trayIcon.Icon = System.Drawing.SystemIcons.Application; }
        trayIcon.Text = "Special Room - For Nurse IPD";
        trayIcon.Visible = true;

        var menu = new ContextMenuStrip();
        menu.Items.Add("เปิดหน้าเว็บ", null, (s, e) => OpenBrowser());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("ออกจากโปรแกรม", null, (s, e) => ExitApp());
        trayIcon.ContextMenuStrip = menu;
        trayIcon.DoubleClick += (s, e) => OpenBrowser();
    }

    bool IsPortOpen()
    {
        try
        {
            using (var c = new TcpClient())
            {
                var task = c.BeginConnect("127.0.0.1", PORT, null, null);
                bool ok = task.AsyncWaitHandle.WaitOne(500);
                if (ok && c.Connected) { c.EndConnect(task); return true; }
                return false;
            }
        }
        catch { return false; }
    }

    void StartServerIfNeeded()
    {
        if (IsPortOpen()) return; // มี server รันอยู่แล้ว (เช่นเปิดโปรแกรมซ้ำ) ไม่ต้อง spawn ใหม่

        if (!File.Exists(serverExe))
        {
            MessageBox.Show("ไม่พบไฟล์โปรแกรมหลัก:\n" + serverExe, "Special Room - For Nurse IPD",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Application.Exit();
            return;
        }

        try { if (!Directory.Exists(logDir)) Directory.CreateDirectory(logDir); } catch { }

        var psi = new ProcessStartInfo(serverExe)
        {
            WorkingDirectory = Path.Combine(baseDir, "server"),
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        serverProcess = new Process();
        serverProcess.StartInfo = psi;
        serverProcess.EnableRaisingEvents = true;
        try
        {
            var logStream = new StreamWriter(new FileStream(logFile, FileMode.Create, FileAccess.Write, FileShare.Read));
            logStream.AutoFlush = true;
            serverProcess.OutputDataReceived += (s, e) => { if (e.Data != null) try { logStream.WriteLine(e.Data); } catch { } };
            serverProcess.ErrorDataReceived  += (s, e) => { if (e.Data != null) try { logStream.WriteLine(e.Data); } catch { } };
            serverProcess.Start();
            serverProcess.BeginOutputReadLine();
            serverProcess.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            MessageBox.Show("เริ่มโปรแกรมหลักไม่สำเร็จ:\n" + ex.Message, "Special Room - For Nurse IPD",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    void WaitServerThenOpenBrowser()
    {
        for (int i = 0; i < 40; i++) // รอสูงสุด ~20 วินาที
        {
            if (IsPortOpen()) { OpenBrowser(); return; }
            Thread.Sleep(500);
        }
    }

    void OpenBrowser()
    {
        try { Process.Start("http://localhost:" + PORT + "/"); }
        catch { }
    }

    void ExitApp()
    {
        try
        {
            if (serverProcess != null && !serverProcess.HasExited)
            {
                serverProcess.Kill();
            }
        }
        catch { }
        trayIcon.Visible = false;
        Application.Exit();
    }
}

class Launcher
{
    [STAThread]
    static void Main()
    {
        // ป้องกันเปิดซ้ำหลายชุด (mutex ระดับเครื่อง)
        bool created;
        var mutex = new System.Threading.Mutex(true, "SpecialRoomSystem_Launcher_Mutex", out created);
        if (!created)
        {
            // มีอินสแตนซ์เปิดอยู่แล้ว แค่เปิดเบราว์เซอร์ซ้ำแล้วปิดตัวเองไป
            try { Process.Start("http://localhost:3004/"); } catch { }
            return;
        }

        Application.EnableVisualStyles();
        Application.Run(new TrayApp());
        GC.KeepAlive(mutex);
    }
}
