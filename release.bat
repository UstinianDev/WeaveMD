@echo off
REM ============================================
REM WeaveMD Release Helper
REM 用法：D:\software\WeaveMD\release.bat [版本号]
REM 示例：release.bat 2.0.3
REM ============================================

cd /d D:\software\WeaveMD

set VERSION=%1
if "%VERSION%"=="" (
    echo 请指定版本号，例如: release.bat 2.0.3
    pause
    exit /b 1
)

echo ========================================
echo   WeaveMD Release v%VERSION%
echo ========================================

echo [1/4] 检查文件是否存在...
if not exist "release\WeaveMD-Setup-%VERSION%.exe" (
    echo 错误: release\WeaveMD-Setup-%VERSION%.exe 不存在
    pause
    exit /b 1
)
if not exist "release\WeaveMD-%VERSION%.msi" (
    echo 错误: release\WeaveMD-%VERSION%.msi 不存在
    pause
    exit /b 1
)
if not exist "release\latest.yml" (
    echo 错误: release\latest.yml 不存在
    pause
    exit /b 1
)
echo 文件检查通过。

echo [2/4] 删除旧 release（如果存在）...
gh release delete v%VERSION% --yes --repo UstinianDev/WeaveMD 2>nul

echo [3/4] 创建 release 并上传文件（大文件上传需要等待）...
gh release create v%VERSION% ^
  "release/WeaveMD-Setup-%VERSION%.exe" ^
  "release/WeaveMD-Setup-%VERSION%.exe.blockmap" ^
  "release/WeaveMD-%VERSION%.msi" ^
  "release/latest.yml" ^
  --title "WeaveMD v%VERSION%" ^
  --notes "WeaveMD v%VERSION% 发布" ^
  --repo UstinianDev/WeaveMD

if %ERRORLEVEL% NEQ 0 (
    echo 发布失败！
    pause
    exit /b 1
)

echo [4/4] 完成！
echo 下载链接: https://github.com/UstinianDev/WeaveMD/releases/tag/v%VERSION%
pause