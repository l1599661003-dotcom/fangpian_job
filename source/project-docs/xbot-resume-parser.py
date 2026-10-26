# 使用提醒:
# 1. 在 XBot 全局变量中创建 resume_api_key，并粘贴开发者中心当前 Key。
# 2. “调用流程”节点不要再传旧 api_key；代码会优先读取全局变量。
# 3. Key 不自动过期，但在开发者中心主动轮换后，旧 Key 会立即失效。

import mimetypes
import os
import time

import xbot
from xbot import print, sleep
from .import package
from .package import variables as glv


API_BASE_URL = "https://r5vd-1031.studio.fengbao.com"
FORMATS_API_URL = API_BASE_URL + "/api/public/resumes/formats"
PARSE_API_URL = API_BASE_URL + "/api/public/resumes/parse"
JOB_API_URL = API_BASE_URL + "/api/public/resumes/jobs/{job_id}"

SUPPORTED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".odt", ".rtf", ".txt",
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif",
    ".tif", ".tiff",
}
MAX_FILE_SIZE = 10 * 1024 * 1024


def _get_arg(args, name, default=None):
    if args is None:
        return default
    if isinstance(args, dict):
        value = args.get(name, default)
    else:
        value = getattr(args, name, default)
    return default if value is None else value


def _get_global_variable(name, default=None):
    try:
        return getattr(glv, name)
    except Exception:
        return default


def _clean_api_key(value):
    return str(value or "").strip().strip('"').strip("'").strip()


def _get_api_key(args):
    """优先读取 XBot 全局变量，避免调用节点残留的旧 Key 覆盖当前 Key。"""
    global_key = _clean_api_key(_get_global_variable("resume_api_key", ""))
    argument_key = _clean_api_key(_get_arg(args, "api_key", ""))
    environment_key = _clean_api_key(os.environ.get("RESUME_API_KEY", ""))

    if global_key:
        if argument_key and argument_key != global_key:
            print("调用流程中的 api_key 与全局变量不同，已使用 resume_api_key 全局变量。")
        api_key = global_key
    else:
        api_key = argument_key or environment_key

    if not api_key:
        raise ValueError(
            "没有配置简历解析 API Key。请从人才管理系统“开发者中心”复制当前 Key，"
            "并保存到 XBot 全局变量 resume_api_key。"
        )
    if not api_key.startswith("rf_live_"):
        raise ValueError("API Key 格式不正确；当前 Key 应以 rf_live_ 开头。")
    if len(api_key) < 40:
        raise ValueError("API Key 可能复制不完整，请重新复制开发者中心显示的完整 Key。")
    return api_key


def _resolve_file_path(args):
    file_path = str(_get_arg(args, "file_path", "") or "").strip()
    if file_path:
        return os.path.abspath(os.path.expanduser(file_path.strip('"').strip("'")))

    directory = str(_get_arg(args, "directory", "") or "").strip().strip('"').strip("'")
    filename = str(_get_arg(args, "filename", "") or "").strip().strip('"').strip("'")
    if not directory or not filename:
        raise ValueError("请传入 file_path，或者同时传入 directory 和 filename。")
    return os.path.join(os.path.abspath(os.path.expanduser(directory)), filename)


def _validate_file(file_path):
    if not os.path.isfile(file_path):
        raise FileNotFoundError("本地简历文件不存在：{}".format(file_path))
    extension = os.path.splitext(file_path)[1].lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError("不支持的简历格式：{}".format(extension or "无扩展名"))
    file_size = os.path.getsize(file_path)
    if file_size <= 0:
        raise ValueError("简历文件为空：{}".format(file_path))
    if file_size > MAX_FILE_SIZE:
        raise ValueError("简历文件超过接口允许的 10MB 限制。")
    return {"extension": extension, "size_mb": round(file_size / 1024 / 1024, 2)}


def _response_error(response):
    status_code = response.status_code
    if status_code == 401:
        return "API Key 无效、缺失或已经被轮换，请复制开发者中心当前 Key。"
    if status_code == 403:
        return "请求被访问权限拦截，请确认使用正式生产域名且应用允许外部调用。"
    if status_code == 404:
        return "接口不存在，请检查 API_BASE_URL 和接口路径。"
    if status_code == 413:
        return "简历文件过大，当前最大允许 10MB。"
    try:
        data = response.json()
        message = data.get("message")
        if isinstance(message, list):
            message = "；".join(str(item) for item in message)
        return message or data.get("error") or data.get("detail") or "HTTP {}".format(status_code)
    except Exception:
        text = (response.text or "").strip()
        if "<html" in text.lower():
            return "服务返回 HTML 页面，请检查正式地址或应用访问权限。HTTP {}".format(status_code)
        return text[:500] or "HTTP {}".format(status_code)


def _check_api_connection(session, api_key, request_timeout=30):
    print("正在检查简历解析服务和 API Key…")
    response = session.get(
        FORMATS_API_URL,
        headers={"X-API-Key": api_key, "Accept": "application/json"},
        timeout=request_timeout,
    )
    if response.status_code != 200:
        raise RuntimeError("API 连接检查失败：{}".format(_response_error(response)))
    result = response.json()
    print(
        "API 连接成功，最大文件 {}MB，支持 {} 种格式。".format(
            result.get("maxFileSizeMB", 10),
            len(result.get("supportedExtensions", [])),
        )
    )
    return result


def _upload_resume(session, file_path, api_key, upload_timeout=60):
    file_name = os.path.basename(file_path)
    content_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
    print("正在上传简历：{}".format(file_name))
    with open(file_path, "rb") as file_object:
        response = session.post(
            PARSE_API_URL,
            headers={"X-API-Key": api_key, "Accept": "application/json"},
            files={"file": (file_name, file_object, content_type)},
            timeout=upload_timeout,
        )
    if response.status_code != 202:
        raise RuntimeError("上传简历失败：{}".format(_response_error(response)))
    result = response.json()
    job_id = str(result.get("jobId") or "").strip()
    if not job_id:
        raise RuntimeError("上传成功，但接口没有返回 jobId。")
    print("上传成功，任务编号：{}".format(job_id))
    return job_id


def _wait_for_result(session, job_id, api_key, poll_interval, max_wait_seconds, request_timeout=30):
    status_url = JOB_API_URL.format(job_id=job_id)
    headers = {"X-API-Key": api_key, "Accept": "application/json"}
    started_at = time.monotonic()
    last_progress = ""
    transient_failures = 0
    while True:
        elapsed = time.monotonic() - started_at
        if elapsed > max_wait_seconds:
            raise TimeoutError("简历解析等待超时，任务编号：{}".format(job_id))
        response = session.get(status_url, headers=headers, timeout=request_timeout)
        if response.status_code != 200:
            error_text = _response_error(response)
            is_starting = (
                response.status_code in (502, 503, 504)
                or "app server not ready" in error_text.lower()
                or "state=starting" in error_text.lower()
            )
            if is_starting:
                transient_failures += 1
                if transient_failures == 1 or transient_failures % 5 == 0:
                    print("应用服务正在启动，将继续等待解析结果…")
                sleep(poll_interval)
                continue
            raise RuntimeError("查询解析进度失败：{}".format(error_text))
        transient_failures = 0
        job = response.json()
        status = str(job.get("status") or "").lower()
        progress = str(job.get("progress") or "").strip()
        if progress and progress != last_progress:
            print("解析进度：{}".format(progress))
            last_progress = progress
        if status == "done":
            resume = job.get("data")
            if not isinstance(resume, dict):
                raise RuntimeError("解析已完成，但接口没有返回结构化结果。")
            return {"job": job, "resume": resume}
        if status == "failed":
            raise RuntimeError("简历解析失败：{}".format(job.get("error") or progress or "未知错误"))
        sleep(poll_interval)


def parse_resume(file_path, api_key, poll_interval=2, max_wait_seconds=300):
    try:
        import requests
    except ImportError:
        raise RuntimeError("当前 Python 环境没有安装 requests 包。")

    file_info = _validate_file(file_path)
    print("准备解析简历：{}，{}MB".format(os.path.basename(file_path), file_info["size_mb"]))
    session = requests.Session()
    try:
        _check_api_connection(session, api_key)
        job_id = _upload_resume(session, file_path, api_key)
        result = _wait_for_result(
            session, job_id, api_key,
            max(1, float(poll_interval or 2)),
            max(30, int(max_wait_seconds or 300)),
        )
        return {"job_id": job_id, "resume": result["resume"], "job": result["job"]}
    finally:
        session.close()


def _empty_output(message):
    return {
        "success": False, "message": message, "job_id": "",
        "name": "", "age": None, "phone": "", "email": "", "wechat": "", "address": "",
        "self_evaluation": "", "skills_certificates": "", "education_background": "",
        "work_experience": "", "job_intention": "", "years_of_experience": "",
        "source_file_name": "", "source_file_url": "", "candidate_id": "",
        "application_id": "", "duplicate": False, "suspicious_duplicate_count": 0,
        "analysis": {}, "matches": [], "resume_version": {}, "resume": {},
    }


def parse_and_build_output(file_path, api_key, poll_interval=2, max_wait_seconds=300):
    try:
        result = parse_resume(file_path, api_key, poll_interval, max_wait_seconds)
        resume = result["resume"]
        output = {
            "success": True,
            "message": "简历解析成功并已存入数据库",
            "job_id": result["job_id"],
            "name": resume.get("name", ""),
            "age": resume.get("age"),
            "phone": resume.get("phone", ""),
            "email": resume.get("email", ""),
            "wechat": resume.get("wechat", ""),
            "address": resume.get("address", ""),
            "self_evaluation": resume.get("selfEvaluation", ""),
            "skills_certificates": resume.get("skillsCertificates", ""),
            "education_background": resume.get("educationBackground", ""),
            "work_experience": resume.get("workExperience", ""),
            "job_intention": resume.get("jobIntention", ""),
            "years_of_experience": resume.get("yearsOfExperience", ""),
            "source_file_name": resume.get("sourceFileName", ""),
            "source_file_url": resume.get("sourceFileUrl", ""),
            "candidate_id": resume.get("candidateId", ""),
            "application_id": resume.get("applicationId", ""),
            "duplicate": bool(resume.get("duplicate", False)),
            "suspicious_duplicate_count": resume.get("suspiciousDuplicateCount", 0),
            "analysis": resume.get("analysis") or {},
            "matches": resume.get("matches") or [],
            "resume_version": resume.get("resumeVersion") or {},
            "resume": resume,
        }
        print("简历解析成功：{}".format(output["name"] or output["source_file_name"]))
        return output
    except Exception as error:
        message = str(error)
        print("简历解析失败：{}".format(message))
        return _empty_output(message)


def main(args):
    """XBot 标准入口：支持 file_path 或 directory + filename。"""
    if args is None:
        args = {}
    try:
        file_path = _resolve_file_path(args)
        api_key = _get_api_key(args)
        return parse_and_build_output(
            file_path=file_path,
            api_key=api_key,
            poll_interval=_get_arg(args, "poll_interval", 2),
            max_wait_seconds=_get_arg(args, "max_wait_seconds", 300),
        )
    except Exception as error:
        message = str(error)
        print("简历解析流程启动失败：{}".format(message))
        return _empty_output(message)
