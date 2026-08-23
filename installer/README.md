# Build Special_room-For_Nurse_IPD.exe

ต้องมี: Node.js/npm, [Inno Setup 6](https://jrsoftware.org/isinfo.php) (ISCC.exe), และ .NET Framework csc.exe
(`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` — มีมาให้แล้วบน Windows ส่วนใหญ่)

1. Build server เป็น .exe เดียว (bundle Node runtime ไว้ในตัว ไม่ต้องติดตั้ง Node บนเครื่องปลายทาง):
   ```
   npm run build:exe
   ```
   ได้ไฟล์ `build/special_room-server.exe` แล้ว copy ไปไว้ที่ `build/server/special_room-server.exe`

2. Compile launcher (โปรแกรมเปิดแบบไม่มีหน้าต่าง cmd + tray icon):
   ```
   csc /target:winexe /out:installer\Launcher.exe /win32icon:installer\icon.ico /win32manifest:installer\Launcher.exe.manifest /reference:System.Windows.Forms.dll,System.Drawing.dll installer\Launcher.cs
   ```
   ต้องใส่ `/win32manifest` เสมอ — ถ้าไม่ใส่ Windows บางเครื่องจะเข้าใจผิดว่า Launcher.exe เป็นตัว installer (heuristic ของ UAC เช็ค exe ที่ไม่มี manifest) แล้ว auto-run แบบ elevated ทำให้ installer เวอร์ชันถัดไป (ที่รันแบบ non-admin) ปิด/แทนที่ไฟล์นี้ไม่ได้

3. (ถ้าต้องทำ icon ใหม่) compile + run ตัวสร้างไอคอน:
   ```
   csc /target:exe /out:installer\IconGen.exe /reference:System.Drawing.dll installer\IconGen.cs
   installer\IconGen.exe installer\icon.ico
   ```

4. Compile installer:
   ```
   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\setup.iss
   ```
   ได้ไฟล์ `dist\Special_room-For_Nurse_IPD.exe`

## หมายเหตุ
- Server ที่ build ด้วย `pkg` ไม่ต้องพึ่ง Node.js/DB client บนเครื่องที่ติดตั้ง (ใช้ pure-JS driver ทั้ง `pg` และ `mysql2`) จึงไม่มี prerequisite อื่นให้ต้องเช็ค/ข้ามระหว่างติดตั้ง
- `config/connection.json` ไม่ถูก bundle เข้าไปใน exe — ผู้ใช้ต้องตั้งค่าการเชื่อมต่อผ่านหน้า settings.html ครั้งแรกที่เปิดโปรแกรม (ไฟล์จะถูกสร้างที่ `<install_dir>\config\connection.json`)
- ตัว installer ตั้ง AppId คงที่ไว้ ถ้าเวอร์ชันเดิมเคยติดตั้งอยู่ จะถูก uninstall แบบ silent ก่อนติดตั้งเวอร์ชันใหม่อัตโนมัติ (ดู `InitializeSetup` ใน `setup.iss`)
