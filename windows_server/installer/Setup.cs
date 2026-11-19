// Asta Talk Server Setup.exe: a small window that unpacks the files appended to this exe and runs install.ps1.
// Built by windows_server\build.py with the .NET Framework C# compiler that ships with Windows (C# 5).
// Layout at the end of the exe: [payload.zip][install.ps1][int64 zipLen][int64 ps1Len]["ASTASETP"]
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Asta Talk Server Setup")]
[assembly: System.Reflection.AssemblyProduct("Asta Talk Server")]
[assembly: System.Reflection.AssemblyCompany("LevelUp Systems")]

class Setup : Form
{
    const string Magic = "ASTASETP";
    static string Version = "1.0.0";

    TextBox folder = new TextBox();
    Button browse = new Button();
    Button install = new Button();
    ProgressBar bar = new ProgressBar();
    Label status = new Label();
    TextBox log = new TextBox();
    bool done;

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.Run(new Setup());
    }

    Setup()
    {
        Text = "Asta Talk Server " + Version + " Setup";
        Font = new Font("Segoe UI", 9.5f);
        ClientSize = new Size(560, 400);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        var title = new Label { Text = "Asta Talk Server", Font = new Font("Segoe UI", 16f, FontStyle.Bold), AutoSize = true, Location = new Point(20, 16) };
        var intro = new Label
        {
            Text = "Installs the translator server for your office: website, phone app connection, calls and meetings. "
                 + "It starts automatically with Windows. Your data stays on this PC.",
            Location = new Point(22, 56), Size = new Size(520, 42)
        };
        var flabel = new Label { Text = "Install folder", AutoSize = true, Location = new Point(22, 108) };
        folder.Location = new Point(22, 130);
        folder.Size = new Size(420, 26);
        folder.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "ASTA Server");
        browse.Text = "Browse...";
        browse.Location = new Point(450, 128);
        browse.Size = new Size(88, 28);
        browse.Click += delegate
        {
            using (var d = new FolderBrowserDialog())
            {
                d.SelectedPath = folder.Text;
                if (d.ShowDialog(this) == DialogResult.OK) folder.Text = Path.Combine(d.SelectedPath, "ASTA Server");
            }
        };
        bar.Location = new Point(22, 172);
        bar.Size = new Size(516, 18);
        bar.Style = ProgressBarStyle.Continuous;
        status.Location = new Point(22, 196);
        status.Size = new Size(516, 20);
        status.Text = "Ready to install. Needs about 700 MB of disk space.";
        log.Location = new Point(22, 220);
        log.Size = new Size(516, 120);
        log.Multiline = true;
        log.ReadOnly = true;
        log.ScrollBars = ScrollBars.Vertical;
        log.BackColor = SystemColors.Window;
        log.Font = new Font("Consolas", 8.5f);
        install.Text = "Install";
        install.Location = new Point(438, 352);
        install.Size = new Size(100, 32);
        install.Click += OnInstall;
        AcceptButton = install;

        Controls.AddRange(new Control[] { title, intro, flabel, folder, browse, bar, status, log, install });
    }

    void Ui(Action a)
    {
        if (IsDisposed) return;
        if (InvokeRequired) BeginInvoke(a); else a();
    }

    void Log(string line)
    {
        if (line == null) return;
        line = line.Trim();
        if (line.Length == 0) return;
        Ui(delegate
        {
            log.AppendText(line + Environment.NewLine);
            status.Text = line;
            if (bar.Value < 95) bar.Value = Math.Min(95, bar.Value + 8);
        });
    }

    void OnInstall(object sender, EventArgs e)
    {
        if (done) { Close(); return; }
        install.Enabled = false;
        browse.Enabled = false;
        folder.Enabled = false;
        string target = folder.Text.Trim();
        var t = new Thread(delegate () { Run(target); });
        t.IsBackground = true;
        t.Start();
    }

    void Run(string target)
    {
        string work = Path.Combine(Path.GetTempPath(), "ASTA-Setup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        int code = 1;
        try
        {
            Directory.CreateDirectory(work);
            Log("Unpacking setup files...");
            string zip = Path.Combine(work, "payload.zip");
            string ps1 = Path.Combine(work, "install.ps1");
            Unpack(zip, ps1);
            Ui(delegate { bar.Value = 15; });

            var psi = new ProcessStartInfo("powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -File \"" + ps1 + "\" -Payload \"" + zip + "\" -InstallDir \"" + target + "\" -Unattended");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.WorkingDirectory = work;
            using (var p = Process.Start(psi))
            {
                p.OutputDataReceived += delegate (object s, DataReceivedEventArgs a) { Log(a.Data); };
                p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs a) { Log(a.Data); };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit();
                code = p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Log("Error: " + ex.Message);
        }
        finally
        {
            try { Directory.Delete(work, true); } catch { }
        }
        bool ok = code == 0;
        Ui(delegate
        {
            bar.Value = ok ? 100 : bar.Value;
            status.Text = ok ? "Asta Talk Server is installed and running. Use the Asta Talk Server window to finish setup."
                             : "Installation failed. See the messages above.";
            status.ForeColor = ok ? Color.FromArgb(6, 118, 71) : Color.FromArgb(180, 35, 24);
            install.Text = "Close";
            install.Enabled = true;
            done = true;
        });
    }

    static void Unpack(string zipPath, string ps1Path)
    {
        using (var fs = new FileStream(Application.ExecutablePath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            var tail = new byte[24];
            fs.Seek(-24, SeekOrigin.End);
            ReadAll(fs, tail, 24);
            if (Encoding.ASCII.GetString(tail, 16, 8) != Magic) throw new Exception("This setup file is damaged (no payload). Download it again.");
            long zipLen = BitConverter.ToInt64(tail, 0);
            long psLen = BitConverter.ToInt64(tail, 8);
            long start = fs.Length - 24 - psLen - zipLen;
            fs.Seek(start, SeekOrigin.Begin);
            Copy(fs, zipPath, zipLen);
            Copy(fs, ps1Path, psLen);
        }
    }

    static void ReadAll(Stream s, byte[] buf, int n)
    {
        int got = 0;
        while (got < n)
        {
            int r = s.Read(buf, got, n - got);
            if (r <= 0) throw new EndOfStreamException();
            got += r;
        }
    }

    static void Copy(Stream src, string path, long len)
    {
        var buf = new byte[1 << 20];
        using (var o = new FileStream(path, FileMode.Create, FileAccess.Write))
        {
            while (len > 0)
            {
                int r = src.Read(buf, 0, (int)Math.Min(buf.Length, len));
                if (r <= 0) throw new EndOfStreamException();
                o.Write(buf, 0, r);
                len -= r;
            }
        }
    }
}
