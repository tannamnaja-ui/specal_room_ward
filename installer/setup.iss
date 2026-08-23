; Special Room System - Offline Full Installer
; Bundles a pkg-compiled, self-contained Node.js server (no Node.js install needed)
; plus a hidden-window C# launcher (no console window shown to the user).

#define MyAppName "Special Room - For Nurse IPD"
#define MyAppVersion "1.0.8"
#define MyAppPublisher "Hospital Private Room System"
#define MyAppExeName "Launcher.exe"

[Setup]
AppId={{6C8F0B2E-6F1E-4E8B-9B8A-2B8F6D3B7E10}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\SpecialRoomSystem
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Special_room-For_Nurse_IPD
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=no
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "thai"; MessagesFile: "compiler:Languages\Thai.isl"

[Files]
Source: "Launcher.exe"; DestDir: "{app}"; Flags: ignoreversion restartreplace
Source: "..\build\server\special_room-server.exe"; DestDir: "{app}\server"; Flags: ignoreversion restartreplace

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "เปิดใช้งาน {#MyAppName}"; Flags: nowait postinstall

[Code]
var
  g_HasConfigBackup: Boolean;
  g_ConfigBackupPath: String;

// ลบ/ถอนการติดตั้งเวอร์ชันเดิมแบบเงียบก่อนติดตั้งเวอร์ชันใหม่ (ตรวจจากรีจิสทรีของ AppId เดียวกัน)
function GetUninstallString(): String;
var
  sUnInstPath: String;
  sUnInstallString: String;
begin
  sUnInstPath := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1';
  sUnInstallString := '';
  if not RegQueryStringValue(HKCU, sUnInstPath, 'UninstallString', sUnInstallString) then
    RegQueryStringValue(HKLM, sUnInstPath, 'UninstallString', sUnInstallString);
  Result := sUnInstallString;
end;

procedure KillServerIfRunning();
var
  ResultCode: Integer;
begin
  Exec('taskkill.exe', '/F /IM special_room-server.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('taskkill.exe', '/F /IM Launcher.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function InitializeSetup(): Boolean;
var
  sUnInstallString: String;
  iResultCode: Integer;
  sOldInstallDir: String;
  sOldConfigFile: String;
begin
  Result := True;
  KillServerIfRunning();

  // รัน uninstaller ของเวอร์ชันเดิม (ถ้ามี) แบบเงียบก่อน
  sUnInstallString := GetUninstallString();
  if sUnInstallString <> '' then
  begin
    sUnInstallString := RemoveQuotes(sUnInstallString);
    Exec(sUnInstallString, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART', '', SW_HIDE, ewWaitUntilTerminated, iResultCode);
  end;

  sOldInstallDir := ExpandConstant('{localappdata}\SpecialRoomSystem');
  sOldConfigFile := sOldInstallDir + '\server\config\connection.json';

  // สำรองค่าเชื่อมต่อ DB เดิมไว้ก่อนลบทั้งโฟลเดอร์ จะได้คืนกลับมาให้หลังติดตั้งเวอร์ชันใหม่เสร็จ
  g_HasConfigBackup := False;
  if FileExists(sOldConfigFile) then
  begin
    g_ConfigBackupPath := ExpandConstant('{tmp}\connection.json.bak');
    g_HasConfigBackup := CopyFile(sOldConfigFile, g_ConfigBackupPath, False);
  end;

  // ลบโฟลเดอร์ติดตั้งเดิมทั้งหมดให้เกลี้ยง (รวมไฟล์ที่โปรแกรมสร้างเพิ่มตอนใช้งาน เช่น logs
  // ที่ uninstaller มาตรฐานจะไม่ลบให้ เพราะไม่ได้เป็นไฟล์ที่ตัว installer เดิมติดตั้งไว้)
  if DirExists(sOldInstallDir) then
    DelTree(sOldInstallDir, True, True, True);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  sNewConfigDir: String;
begin
  if (CurStep = ssPostInstall) and g_HasConfigBackup then
  begin
    sNewConfigDir := ExpandConstant('{app}\server\config');
    if not DirExists(sNewConfigDir) then
      ForceDirectories(sNewConfigDir);
    CopyFile(g_ConfigBackupPath, sNewConfigDir + '\connection.json', False);
  end;
end;
