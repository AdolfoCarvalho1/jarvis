' Inicia o J.A.R.V.I.S. sem janela de console.
' O log do servidor vai para .jarvis\server.log (sobrescrito a cada início).

Option Explicit

Dim fso, shell, root, logDir, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = root & "\.jarvis"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)

shell.CurrentDirectory = root
command = "cmd /c serve.cmd > """ & logDir & "\server.log"" 2>&1"
shell.Run command, 0, False
