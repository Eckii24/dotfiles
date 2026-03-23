#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlparse
from html import unescape

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)
REQUIRED_PACKAGES = [
    "trafilatura",
    "beautifulsoup4",
    "html2text",
    "lxml",
    "readability-lxml",
]


def ensure_dependencies(skill_dir: Path) -> None:
    deps_dir = skill_dir / ".deps"
    deps_dir.mkdir(parents=True, exist_ok=True)
    if str(deps_dir) not in sys.path:
        sys.path.insert(0, str(deps_dir))

    needed = []
    for module_name, package_name in [
        ("trafilatura", "trafilatura"),
        ("bs4", "beautifulsoup4"),
        ("html2text", "html2text"),
        ("readability", "readability-lxml"),
    ]:
        try:
            importlib.import_module(module_name)
        except ModuleNotFoundError:
            needed.append(package_name)

    if needed:
        subprocess.check_call(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--quiet",
                "--target",
                str(deps_dir),
                *REQUIRED_PACKAGES,
            ]
        )


def normalize_url(url: str) -> str:
    url = unescape(url.strip())
    return url


def fetch_html(url: str) -> str:
    result = subprocess.run(
        ["curl", "-LksS", "-A", USER_AGENT, url],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def slugify(value: str) -> str:
    value = unescape(value)
    value = re.sub(r"\s+", "-", value.strip().lower())
    value = re.sub(r"[^a-z0-9._-]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-._")
    return value or "page"


def normalize_words(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def clean_link_targets(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        open_marker = match.group(1)
        target = re.sub(r"\s+", "", match.group(2))
        close_marker = match.group(3)
        return f"({open_marker}{target}{close_marker})"

    text = re.sub(r"\((<?)(https?://[^)]+?)(>?)\)", repl, text)
    return text


def strip_duplicate_title(body: str, title: str) -> str:
    lines = body.splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return ""

    first = lines[0].strip()
    if first.startswith("#"):
        first = re.sub(r"^#+\s*", "", first)

    if normalize_words(first) == normalize_words(title):
        lines.pop(0)
        while lines and not lines[0].strip():
            lines.pop(0)

    return "\n".join(lines)


def clean_markdown(body: str, title: str) -> str:
    body = body.replace("\r\n", "\n").replace("\r", "\n").strip()
    body = strip_duplicate_title(body, title)
    body = clean_link_targets(body)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def extract_title(html: str) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    for attrs in (
        {"property": "og:title"},
        {"name": "twitter:title"},
    ):
        node = soup.find("meta", attrs=attrs)
        if node and node.get("content"):
            return " ".join(node["content"].split())

    if soup.title and soup.title.get_text(strip=True):
        return " ".join(soup.title.get_text(" ", strip=True).split())

    h1 = soup.find("h1")
    if h1:
        return " ".join(h1.get_text(" ", strip=True).split())

    parsed = urlparse("https://example.com")
    _ = parsed  # silence linters in case of future edits
    return "Untitled Page"


def extract_trafilatura(html: str) -> Optional[str]:
    import trafilatura

    return trafilatura.extract(
        html,
        output_format="markdown",
        include_links=True,
        include_formatting=True,
        favor_precision=True,
    )


def extract_readability(html: str) -> str:
    import html2text
    from readability import Document

    document = Document(html)
    main_html = document.summary(html_partial=True)
    converter = html2text.HTML2Text()
    converter.body_width = 0
    converter.ignore_images = True
    converter.ignore_links = False
    converter.protect_links = True
    converter.mark_code = True
    converter.wrap_links = False
    return converter.handle(main_html)


def convert_html_to_markdown(html: str, title: str, extractor: str) -> tuple[str, str]:
    body = None
    used = extractor

    if extractor in {"auto", "trafilatura"}:
        try:
            body = extract_trafilatura(html)
            if body:
                body = clean_markdown(body, title)
        except Exception:
            body = None
        if extractor == "trafilatura":
            return (body or "", "trafilatura")

    if not body:
        used = "readability"
        body = extract_readability(html)
        body = clean_markdown(body, title)

    return body, used


def choose_output_path(url: str, title: str, output: Optional[str], out_dir: Optional[str]) -> Path:
    if output:
        path = Path(output)
        if path.suffix.lower() != ".md":
            path = path.with_suffix(".md")
        return path

    directory = Path(out_dir) if out_dir else Path.cwd()
    directory.mkdir(parents=True, exist_ok=True)

    parsed = urlparse(url)
    candidate = slugify(title)
    if not candidate:
        candidate = slugify(unquote(Path(parsed.path).stem or parsed.netloc))
    return directory / f"{candidate}.md"


def build_markdown(title: str, url: str, body: str) -> str:
    retrieved = date.today().isoformat()
    return (
        f"# {title}\n\n"
        f"- Source URL: {url}\n"
        f"- Retrieved: {retrieved}\n\n"
        f"---\n\n"
        f"{body.strip()}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch a website and convert it to Markdown.")
    parser.add_argument("--url", required=True, help="The webpage URL to fetch.")
    parser.add_argument("--output", help="Exact output markdown file path.")
    parser.add_argument("--out-dir", help="Output directory when auto-naming the file.")
    parser.add_argument(
        "--extractor",
        choices=["auto", "trafilatura", "readability"],
        default="auto",
        help="Extraction strategy to use.",
    )
    args = parser.parse_args()

    skill_dir = Path(__file__).resolve().parents[1]
    ensure_dependencies(skill_dir)

    url = normalize_url(args.url)
    html = fetch_html(url)
    title = extract_title(html)
    body, used_extractor = convert_html_to_markdown(html, title, args.extractor)

    if not body or len(body.strip()) < 200:
        raise SystemExit(f"Extraction produced too little content for {url}.")

    output_path = choose_output_path(url, title, args.output, args.out_dir)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(build_markdown(title, url, body), encoding="utf-8")

    print(f"Saved markdown to: {output_path}")
    print(f"Extractor used: {used_extractor}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
