#!/usr/bin/env python3
"""
Telegram News System - 資料表清空工具
一次性清空資料表的互動式 Python 工具
"""

import subprocess
import sys
import os
import argparse
from typing import Optional

class Colors:
    """終端機顏色碼"""
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'
    END = '\033[0m'

def print_header():
    """印出程式標題"""
    print(f"\n{Colors.CYAN}{Colors.BOLD}{'='*60}{Colors.END}")
    print(f"{Colors.CYAN}{Colors.BOLD}    Telegram News System - 資料表清空工具{Colors.END}")
    print(f"{Colors.CYAN}{Colors.BOLD}{'='*60}{Colors.END}\n")

def print_menu():
    """印出選項菜單"""
    print(f"{Colors.YELLOW}{Colors.BOLD}請選擇要執行的操作：{Colors.END}\n")
    
    # 兩欄式菜單顯示
    menu_items = [
        ("1", "清空所有資料表 (推薦)", "GREEN"),
        ("2", "完整重置 (含計數器)", "GREEN"),
        ("3", "僅清空推播記錄", "GREEN"),
        ("4", "僅清空新聞貼文", "GREEN"),
        ("5", "僅清空訂閱記錄", "GREEN"),
        ("6", "分步驟清空", "GREEN"),
        ("7", "查看資料表狀態", "GREEN"),
        ("0", "退出程式", "RED"),
    ]
    
    # 計算每欄的寬度
    col_width = 35
    
    # 兩欄式顯示
    for i in range(0, len(menu_items), 2):
        left_item = menu_items[i]
        right_item = menu_items[i + 1] if i + 1 < len(menu_items) else None
        
        # 左欄
        left_color = getattr(Colors, left_item[2])
        left_text = f"{left_color}{left_item[0]}.{Colors.END} {left_item[1]}"
        
        # 右欄
        if right_item:
            right_color = getattr(Colors, right_item[2])
            right_text = f"{right_color}{right_item[0]}.{Colors.END} {right_item[1]}"
            print(f"{left_text:<{col_width}} {right_text}")
        else:
            print(f"{left_text}")
    
    print()  # 空行

def execute_wrangler_command(command: str, description: str = "", remote: bool = False) -> bool:
    """
    執行 wrangler 指令
    
    Args:
        command: SQL 指令（可以包含多個用分號分隔的語句）
        description: 操作描述
        remote: 是否在遠端資料庫執行
    
    Returns:
        bool: 執行成功與否
    """
    try:
        if description:
            print(f"{Colors.BLUE}正在執行：{description}{Colors.END}")
        
        # 將複合 SQL 指令分解為單獨的語句
        commands = [cmd.strip() for cmd in command.split(';') if cmd.strip()]
        
        success_count = 0
        for i, single_command in enumerate(commands, 1):
            # 建構指令
            cmd_parts = ['wrangler', 'd1', 'execute', 'telegram_news_db', '--command', single_command]
            if remote:
                cmd_parts.append('--remote')
            
            remote_flag = " --remote" if remote else ""
            print(f"{Colors.WHITE}指令 {i}/{len(commands)}：wrangler d1 execute telegram_news_db --command \"{single_command}\"{remote_flag}{Colors.END}")
            
            # 執行指令
            result = subprocess.run(cmd_parts, capture_output=True, text=True, check=True)
            
            print(f"{Colors.GREEN}✅ 指令 {i} 執行成功{Colors.END}")
            if result.stdout:
                print(f"{Colors.WHITE}輸出：{result.stdout}{Colors.END}")
            
            success_count += 1
        
        if not remote and len(commands) > 1:
            print(f"{Colors.CYAN}💡 提示：若要在遠端資料庫執行，請使用 --remote 參數啟動此腳本{Colors.END}")
        
        print(f"{Colors.GREEN}🎉 所有指令執行完成 ({success_count}/{len(commands)}){Colors.END}")
        return True
        
    except subprocess.CalledProcessError as e:
        print(f"{Colors.RED}❌ 指令執行失敗：{e}{Colors.END}")
        if e.stdout:
            print(f"{Colors.WHITE}標準輸出：{e.stdout}{Colors.END}")
        if e.stderr:
            print(f"{Colors.RED}錯誤輸出：{e.stderr}{Colors.END}")
        
        # 提供常見問題的解決建議
        if remote:
            print(f"\n{Colors.YELLOW}💡 遠端執行常見問題：{Colors.END}")
            print(f"{Colors.YELLOW}   1. 請確認已登入 Cloudflare：wrangler auth login{Colors.END}")
            print(f"{Colors.YELLOW}   2. 請確認資料庫在遠端環境存在{Colors.END}")
            print(f"{Colors.YELLOW}   3. 請檢查網路連接狀態{Colors.END}")
            print(f"{Colors.YELLOW}   4. 請確認帳戶有足夠權限操作遠端資料庫{Colors.END}")
        
        return False
    
    except FileNotFoundError:
        print(f"{Colors.RED}❌ 找不到 wrangler 指令，請確認已安裝 Cloudflare Workers CLI{Colors.END}")
        return False

def confirm_action(message: str) -> bool:
    """
    確認操作
    
    Args:
        message: 確認訊息
    
    Returns:
        bool: 使用者是否確認
    """
    while True:
        response = input(f"{Colors.YELLOW}⚠️  {message} (y/N): {Colors.END}").lower().strip()
        if response in ['y', 'yes']:
            return True
        elif response in ['n', 'no', '']:
            return False
        else:
            print(f"{Colors.RED}請輸入 y 或 n{Colors.END}")

def get_table_status(remote: bool = False):
    """查看資料表狀態"""
    tables = ['deliveries', 'posts', 'subscriptions']
    
    print(f"{Colors.BLUE}正在查詢資料表狀態...{Colors.END}")
    if not remote:
        print(f"{Colors.CYAN}💡 提示：若要查詢遠端資料庫，請使用 --remote 參數啟動此腳本{Colors.END}")
    print()
    
    for table in tables:
        command = f"SELECT COUNT(*) as count FROM {table};"
        try:
            # 建構指令
            cmd_parts = ['wrangler', 'd1', 'execute', 'telegram_news_db', '--command', command]
            if remote:
                cmd_parts.append('--remote')
            
            result = subprocess.run(cmd_parts, capture_output=True, text=True, check=True)
            
            # 解析輸出中的數字
            lines = result.stdout.strip().split('\n')
            count = "未知"
            for line in lines:
                if line.strip().isdigit():
                    count = line.strip()
                    break
            
            print(f"{Colors.GREEN}📊 {table:15}: {count:>10} 筆記錄{Colors.END}")
            
        except Exception as e:
            print(f"{Colors.RED}📊 {table:15}: 查詢失敗 - {e}{Colors.END}")
    
    print()

def main():
    """主程式"""
    # 解析命令行參數
    parser = argparse.ArgumentParser(
        description='Telegram News System - 資料表清空工具',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用範例:
  python truncate_tables.py           # 在本地資料庫執行
  python truncate_tables.py --remote  # 在遠端資料庫執行
        """
    )
    parser.add_argument(
        '--remote', 
        action='store_true', 
        help='在遠端資料庫執行操作（默認為本地）'
    )
    
    args = parser.parse_args()
    
    print_header()
    
    # 顯示當前模式
    if args.remote:
        print(f"{Colors.RED}{Colors.BOLD}🌐 遠端資料庫模式{Colors.END}")
        print(f"{Colors.YELLOW}⚠️  所有操作將在生產環境的遠端資料庫執行！{Colors.END}\n")
    else:
        print(f"{Colors.GREEN}{Colors.BOLD}🏠 本地資料庫模式{Colors.END}")
        print(f"{Colors.CYAN}ℹ️  所有操作將在本地開發環境執行{Colors.END}\n")
    
    # 檢查是否在正確的目錄
    if not os.path.exists('wrangler.jsonc'):
        print(f"{Colors.RED}❌ 找不到 wrangler.jsonc 檔案{Colors.END}")
        print(f"{Colors.YELLOW}請確認您在 telegram-news 專案根目錄中執行此腳本{Colors.END}")
        sys.exit(1)
    
    while True:
        print_menu()
        
        try:
            choice = input(f"{Colors.BOLD}請輸入選項 (0-7): {Colors.END}").strip()
            
            if choice == '0':
                print(f"{Colors.CYAN}👋 再見！{Colors.END}")
                break
                
            elif choice == '1':
                if confirm_action("確定要清空所有資料表嗎？此操作無法復原！"):
                    command = "DELETE FROM deliveries; DELETE FROM posts; DELETE FROM subscriptions;"
                    execute_wrangler_command(command, "清空所有資料表", args.remote)
                
            elif choice == '2':
                if confirm_action("確定要完整重置所有資料表嗎？此操作無法復原！"):
                    command = ("DELETE FROM deliveries; DELETE FROM posts; DELETE FROM subscriptions; "
                             "UPDATE sqlite_sequence SET seq = 0 WHERE name IN ('deliveries', 'posts', 'subscriptions');")
                    execute_wrangler_command(command, "完整重置所有資料表", args.remote)
                
            elif choice == '3':
                if confirm_action("確定要清空推播記錄資料表嗎？"):
                    execute_wrangler_command("DELETE FROM deliveries;", "清空推播記錄", args.remote)
                
            elif choice == '4':
                if confirm_action("確定要清空新聞貼文資料表嗎？"):
                    execute_wrangler_command("DELETE FROM posts;", "清空新聞貼文", args.remote)
                
            elif choice == '5':
                if confirm_action("確定要清空訂閱記錄資料表嗎？"):
                    execute_wrangler_command("DELETE FROM subscriptions;", "清空訂閱記錄", args.remote)
                
            elif choice == '6':
                if confirm_action("確定要分步驟清空所有資料表嗎？此操作無法復原！"):
                    print(f"{Colors.BLUE}開始分步驟清空...{Colors.END}\n")
                    
                    # 按順序執行
                    steps = [
                        ("DELETE FROM deliveries;", "清空推播記錄"),
                        ("DELETE FROM posts;", "清空新聞貼文"),
                        ("DELETE FROM subscriptions;", "清空訂閱記錄")
                    ]
                    
                    all_success = True
                    for command, desc in steps:
                        if not execute_wrangler_command(command, desc, args.remote):
                            all_success = False
                            break
                        print()
                    
                    if all_success:
                        print(f"{Colors.GREEN}🎉 所有資料表清空完成！{Colors.END}")
                    else:
                        print(f"{Colors.RED}⚠️  部分操作失敗，請檢查錯誤訊息{Colors.END}")
                
            elif choice == '7':
                get_table_status(args.remote)
                
            else:
                print(f"{Colors.RED}無效選項，請輸入 0-7 之間的數字{Colors.END}")
            
            # 操作完成後暫停
            if choice != '0' and choice != '7':
                input(f"\n{Colors.CYAN}按 Enter 繼續...{Colors.END}")
                print("\n" + "="*60 + "\n")
        
        except KeyboardInterrupt:
            print(f"\n\n{Colors.YELLOW}操作已中止{Colors.END}")
            break
        except Exception as e:
            print(f"{Colors.RED}發生錯誤：{e}{Colors.END}")

if __name__ == "__main__":
    main()
