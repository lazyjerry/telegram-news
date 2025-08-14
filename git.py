#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Git 自動添加推送到遠端倉庫工具

此腳本提供完整的 Git 工作流程自動化：
1. 檢查當前目錄是否為 Git 倉庫
2. 顯示所有變更的檔案狀態
3. 自動添加所有變更到暫存區
4. 互動式輸入 commit message
5. 確認提交資訊
6. 提交變更到本地倉庫
7. 推送到遠端倉庫

作者: Vibe Jerry
版本: 1.0
"""

import subprocess  # 用於執行系統命令
import sys        # 用於系統相關操作（如 sys.exit()）
import os         # 用於作業系統相關操作
from typing import Optional, Tuple  # 用於型別提示


def run_command(command: list, capture_output: bool = True) -> Tuple[int, str, str]:
    """
    執行系統命令並返回結果
    
    此函數封裝了 subprocess.run() 的調用，提供統一的錯誤處理
    和返回值格式，用於執行所有 Git 命令。
    
    Args:
        command: 要執行的命令列表，例如 ['git', 'status']
        capture_output: 是否捕獲命令的輸出，預設為 True
    
    Returns:
        Tuple[int, str, str]: 包含 (返回碼, 標準輸出, 標準錯誤) 的元組
        - 返回碼: 0 表示成功，非 0 表示失敗
        - 標準輸出: 命令的正常輸出內容
        - 標準錯誤: 命令的錯誤訊息
    """
    try:
        # 使用 subprocess.run 執行命令
        result = subprocess.run(
            command,
            capture_output=capture_output,  # 是否捕獲輸出
            text=True,                      # 以文字模式處理輸出
            encoding='utf-8'                # 使用 UTF-8 編碼
        )
        return result.returncode, result.stdout, result.stderr
    except Exception as e:
        # 如果執行命令時發生異常，記錄錯誤並返回錯誤狀態
        print(f"執行命令時發生錯誤: {e}")
        return 1, "", str(e)


def check_git_repository() -> bool:
    """
    檢查當前目錄是否為 Git 倉庫
    
    使用 'git rev-parse --git-dir' 命令來檢查是否存在 .git 目錄。
    如果命令執行成功（返回碼為 0），則表示當前目錄是 Git 倉庫。
    
    Returns:
        bool: True 表示是 Git 倉庫，False 表示不是
    """
    # 執行 git rev-parse --git-dir 來檢查 Git 倉庫
    # 如果成功，表示當前目錄是 Git 倉庫
    return_code, _, _ = run_command(['git', 'rev-parse', '--git-dir'])
    return return_code == 0


def get_git_status() -> str:
    """
    獲取 Git 倉庫的當前狀態
    
    使用 'git status --porcelain' 命令獲取簡潔格式的狀態輸出。
    --porcelain 選項提供機器可讀的格式，便於程式解析。
    
    Returns:
        str: Git 狀態的簡潔輸出，如果失敗則返回空字串
    """
    # 使用 --porcelain 選項獲取簡潔格式的狀態
    # 格式範例: "M  modified_file.txt" 或 "A  new_file.txt"
    return_code, stdout, stderr = run_command(['git', 'status', '--porcelain'])
    if return_code != 0:
        print(f"獲取 Git 狀態失敗: {stderr}")
        return ""
    return stdout


def add_all_files() -> bool:
    """
    將所有變更的檔案添加到 Git 暫存區
    
    執行 'git add .' 命令，將當前目錄及其子目錄中的所有變更檔案
    添加到 Git 暫存區，準備進行提交。
    
    Returns:
        bool: True 表示添加成功，False 表示添加失敗
    """
    print("正在添加所有變更的檔案...")
    # 執行 git add . 添加所有變更的檔案到暫存區
    return_code, stdout, stderr = run_command(['git', 'add', '.'])
    if return_code != 0:
        print(f"添加檔案失敗: {stderr}")
        return False
    print("檔案添加成功！")
    return True


def get_commit_message() -> Optional[str]:
    """
    獲取用戶輸入的 commit message
    
    顯示提示訊息並等待用戶輸入 commit message。
    會驗證輸入不為空，如果為空則要求重新輸入。
    
    Returns:
        Optional[str]: 用戶輸入的 commit message，如果輸入無效則返回 None
    """
    print("\n" + "="*50)
    print("請輸入 commit message:")
    print("="*50)
    
    # 獲取用戶輸入並去除前後空白
    message = input().strip()
    
    # 驗證 commit message 不能為空
    if not message:
        print("錯誤: commit message 不能為空！")
        return None
    
    return message


def confirm_commit(message: str) -> bool:
    """
    確認是否要提交變更
    
    顯示提交資訊並要求用戶確認是否要進行提交。
    支援多種確認和取消的輸入方式（中英文）。
    
    Args:
        message: 要提交的 commit message
    
    Returns:
        bool: True 表示確認提交，False 表示取消提交
    """
    print("\n" + "="*50)
    print("確認提交資訊:")
    print(f"Commit Message: {message}")
    print("="*50)
    
    # 持續詢問直到獲得有效回應
    while True:
        confirm = input("是否確認提交？(Y/n): ").strip().lower()
        # 如果用戶直接按 Enter（空輸入），預設為確認 (y)
        if confirm == "":
            return True
        # 支援多種確認方式：英文 (y, yes) 和中文 (是, 確認)
        elif confirm in ['y', 'yes', '是', '確認']:
            return True
        # 支援多種取消方式：英文 (n, no) 和中文 (否, 取消)
        elif confirm in ['n', 'no', '否', '取消']:
            return False
        else:
            print("請輸入 y 或 n，或直接按 Enter 確認")


def commit_changes(message: str) -> bool:
    """
    提交變更到本地 Git 倉庫
    
    執行 'git commit -m "message"' 命令，將暫存區中的變更
    提交到本地 Git 倉庫，創建一個新的 commit。
    
    Args:
        message: 提交訊息，描述此次變更的內容
    
    Returns:
        bool: True 表示提交成功，False 表示提交失敗
    """
    print("正在提交變更...")
    # 執行 git commit 命令提交變更
    return_code, stdout, stderr = run_command(['git', 'commit', '-m', message])
    if return_code != 0:
        print(f"提交失敗: {stderr}")
        return False
    print("提交成功！")
    return True


def push_to_remote() -> bool:
    """
    將本地變更推送到遠端倉庫
    
    首先獲取當前分支名稱，然後執行 'git push origin <branch>' 命令
    將本地提交推送到遠端倉庫的對應分支。
    
    Returns:
        bool: True 表示推送成功，False 表示推送失敗
    """
    print("正在推送到遠端倉庫...")
    
    # 步驟 1: 獲取當前分支名稱
    # 使用 'git branch --show-current' 獲取當前分支
    return_code, branch, stderr = run_command(['git', 'branch', '--show-current'])
    if return_code != 0:
        print(f"獲取分支名稱失敗: {stderr}")
        return False
    
    # 去除分支名稱前後的空白字符
    branch = branch.strip()
    
    # 步驟 2: 推送到遠端倉庫
    # 執行 'git push origin <branch>' 推送到遠端
    return_code, stdout, stderr = run_command(['git', 'push', 'origin', branch])
    if return_code != 0:
        print(f"推送失敗: {stderr}")
        return False
    
    print(f"成功推送到遠端分支: {branch}")
    return True


def main():
    """
    主函數 - Git 工作流程的完整執行流程
    
    此函數按照以下順序執行完整的 Git 工作流程：
    1. 環境檢查：確認是否在 Git 倉庫中
    2. 狀態檢查：檢查是否有需要提交的變更
    3. 檔案添加：將所有變更添加到暫存區
    4. 訊息輸入：獲取用戶的 commit message
    5. 確認提交：顯示提交資訊並要求確認
    6. 本地提交：將變更提交到本地倉庫
    7. 遠端推送：將提交推送到遠端倉庫
    """
    # 顯示工具標題
    print("Git 自動添加推送到遠端倉庫工具")
    print("="*50)
    
    # 步驟 1: 檢查是否為 Git 倉庫
    # 確保當前目錄是有效的 Git 倉庫，否則無法執行 Git 操作
    if not check_git_repository():
        print("錯誤: 當前目錄不是 Git 倉庫！")
        print("請在 Git 倉庫目錄中執行此腳本。")
        sys.exit(1)
    
    # 步驟 2: 檢查是否有變更需要提交
    # 獲取當前 Git 狀態，檢查是否有修改、新增或刪除的檔案
    status = get_git_status()
    if not status:
        print("沒有需要提交的變更。")
        sys.exit(0)
    
    # 顯示檢測到的變更
    print("檢測到以下變更:")
    print(status)
    
    # 步驟 3: 添加所有變更的檔案到暫存區
    # 執行 git add . 將所有變更添加到 Git 暫存區
    if not add_all_files():
        sys.exit(1)
    
    # 步驟 4: 獲取用戶輸入的 commit message
    # 提示用戶輸入描述此次變更的提交訊息
    message = get_commit_message()
    if not message:
        sys.exit(1)
    
    # 步驟 5: 確認是否要提交
    # 顯示提交資訊並要求用戶確認，防止意外提交
    if not confirm_commit(message):
        print("已取消提交。")
        sys.exit(0)
    
    # 步驟 6: 提交變更到本地倉庫
    # 執行 git commit 將暫存區的變更提交到本地 Git 倉庫
    if not commit_changes(message):
        sys.exit(1)
    
    # 步驟 7: 推送到遠端倉庫
    # 將本地提交推送到遠端倉庫，與團隊共享變更
    if not push_to_remote():
        sys.exit(1)
    
    # 完成提示
    print("\n" + "="*50)
    print("所有操作完成！")
    print("="*50)


if __name__ == "__main__":
    # 當腳本直接執行時，調用主函數開始 Git 工作流程
    main()
