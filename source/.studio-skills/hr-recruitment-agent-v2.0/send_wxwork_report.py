#!/usr/bin/env python3
r"""
企微群机器人 · 诊断报告文字推送脚本
功能：读取 MD 格式诊断报告，去除 Markdown 标记后直接作为 text 消息推送到企微群

用法：
  python send_wxwork_report.py <report.md> [候选人姓名] [负责人手机号]

示例：
  python send_wxwork_report.py "D:/招聘智能体/md格式简历库/王猛_4449_完整报告_20260522.md" "王猛" "15762703457"
"""

import urllib.request
import json
import sys
import os
import re
import io

# Windows 终端强制 UTF-8 输出
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

# ═══════════════════════════════════════
# 配置区
# ═══════════════════════════════════════
WEBHOOK_KEY = "fcda9ecb-ffae-4568-9837-24e475a68f66"
SEND_URL = f"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={WEBHOOK_KEY}"


def strip_markdown(text):
    """
    去除 Markdown 格式标记，保留纯文本：
    - 去掉 ** 加粗标记
    - 去掉 ``` 代码块标记
    - 去掉 | 表格分隔线（但保留表格内容行）
    - 去掉 > 引用标记
    - 去掉 --- 分隔线
    - 去掉 HTML 标签
    """
    # 去掉代码块
    text = re.sub(r'```[^\n]*\n?', '', text)
    # 去掉 **bold** 标记
    text = text.replace('**', '')
    # 去掉 > 引用
    text = re.sub(r'^>\s?', '', text, flags=re.MULTILINE)
    # 去掉 --- 分隔线
    text = re.sub(r'\n---+\n', '\n', text)
    # 去掉 HTML 标签
    text = re.sub(r'<[^>]+>', '', text)
    return text


def read_report(file_path):
    """读取报告文件，返回纯文本内容"""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"报告文件不存在: {file_path}")

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 只提取 Step 3 部分（从【核心亮点】到报告末尾免责声明之前）
    start = content.find("【核心亮点】")
    if start < 0:
        # 如果找不到，用全文
        text = strip_markdown(content)
    else:
        end = content.find("📌 本报告由 AI 自动生成", start)
        if end < 0:
            end = content.find("本报告由 AI 自动生成", start)
        section = content[start:end] if end > 0 else content[start:]
        text = strip_markdown(section)

    return text.strip()


MAX_LEN = 2000  # 每条消息最大字符数（留 48 字符安全裕量）


def send_text(content, mentioned_mobile_list=None):
    """发送单条 text 消息，支持 @手机号"""
    data = {
        "msgtype": "text",
        "text": {"content": content},
    }
    if mentioned_mobile_list:
        data["text"]["mentioned_mobile_list"] = mentioned_mobile_list

    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(SEND_URL, data=body, method="POST")
    req.add_header("Content-Type", "application/json")

    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def split_message(text, max_len=MAX_LEN):
    """
    将长文本按段落边界拆分为多段，每段不超过 max_len 字符。
    优先在空行处切割，其次在换行处切割。
    """
    if len(text) <= max_len:
        return [text]

    chunks = []
    current = ""
    # 先按双换行（段落）切割
    paragraphs = text.split("\n\n")

    for para in paragraphs:
        candidate = (current + "\n\n" + para).lstrip("\n") if current else para
        if len(candidate) <= max_len:
            current = candidate
        else:
            # 当前段落本身就超长，需要按单行进一步切割
            if current:
                chunks.append(current.strip())
                current = ""
            lines = para.split("\n")
            for line in lines:
                candidate2 = (current + "\n" + line).lstrip("\n") if current else line
                if len(candidate2) <= max_len:
                    current = candidate2
                else:
                    if current:
                        chunks.append(current.strip())
                    # 单行超长：硬切
                    while len(line) > max_len:
                        chunks.append(line[:max_len])
                        line = line[max_len:]
                    current = line

    if current.strip():
        chunks.append(current.strip())

    return chunks


# ═══════════════════════════════════════
# 主流程
# ═══════════════════════════════════════
import time

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python send_wxwork_report.py <report.md> [候选人姓名] [负责人手机号]", file=sys.stderr)
        sys.exit(1)

    report_path = sys.argv[1]
    candidate_name = sys.argv[2] if len(sys.argv) > 2 else "候选人"
    head_mobile = sys.argv[3] if len(sys.argv) > 3 else "15762703457"

    print(f"[PUSH] 开始推送 {candidate_name} 的诊断报告...")

    # --- 读取报告 ---
    try:
        report_text = read_report(report_path)
    except FileNotFoundError as e:
        print(f"[FAIL] {e}", file=sys.stderr)
        sys.exit(1)

    char_count = len(report_text)
    print(f"  (1) 读取报告: {char_count} 字符")

    # --- 组装首条消息（含标题）---
    title = f"【AI初筛报告】{candidate_name}"
    full_msg = title + "\n\n" + report_text

    print(f"  (2) 组装消息: {len(full_msg)} 字符（含标题）")

    # --- 拆分 ---
    parts = split_message(full_msg)
    total = len(parts)
    if total > 1:
        print(f"  (2) 消息超长，自动拆分为 {total} 条发送")

    # --- 逐条发送 ---
    for i, part in enumerate(parts, 1):
        # 首条 @负责人，后续条不重复 @
        mobiles = [head_mobile] if i == 1 else None
        result = send_text(part, mentioned_mobile_list=mobiles)
        status = "[OK]" if result.get("errcode") == 0 else "[FAIL]"
        print(f"  ({i+2}) 企微发送第{i}/{total}条: {status} {len(part)}字符 errcode={result.get('errcode')} errmsg={result.get('errmsg', '')}")

        if result.get("errcode") != 0:
            print(f"\n[FAIL] 第{i}条推送失败: {result}")
            sys.exit(1)

        # 多条时每条间隔 0.5s，避免频率限制
        if i < total:
            time.sleep(0.5)

    print(f"\n[DONE] {candidate_name} 报告推送完成！共发送 {total} 条消息。")
