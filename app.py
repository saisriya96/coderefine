import os
import re
import json
import random
import time
from flask import Flask, render_template, request, jsonify
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# Configure OpenRouter client
client = OpenAI(
    api_key=os.getenv("OPENROUTER_API_KEY"),
    base_url="https://openrouter.ai/api/v1"
)

REVIEW_PROMPT = """
You are an expert code debugger and software engineer. Your PRIMARY job is to find and fix bugs in the following {language} code, then also note any code quality issues.

Debugging means:
- Finding syntax errors, runtime errors, and logical bugs
- Spotting off-by-one errors, null/undefined access, infinite loops, wrong operators, incorrect conditions
- Identifying incorrect algorithm logic that produces wrong output
- Catching unhandled exceptions or missing edge cases

Return your response ONLY as a valid JSON object with this exact structure:
{{
  "issues": [
    {{
      "type": "bug | error | warning | suggestion",
      "line": "line number or range (e.g. 'Line 3' or 'Lines 5-8') or 'General' if not line-specific",
      "description": "clear description of the bug or issue, including what the wrong behavior is and what the fix does"
    }}
  ],
  "improved_code": "the full debugged and corrected version of the code with all bugs fixed",
  "explanation": "a beginner-friendly explanation of what bugs were found, why they were wrong, and what was fixed, in 3-5 sentences",
  "score": a number from 0 to 100 representing the original code quality (deduct heavily for bugs)
}}

Issue type rules:
- "bug": actual logic error, runtime error, or wrong output — the code is broken
- "error": syntax or critical structural problem
- "warning": potentially problematic but not always wrong
- "suggestion": style, readability, or best-practice improvement

Prioritize bugs above all else. If the code has no bugs or issues, return an empty issues array, the original code as improved_code, and a positive explanation.

Code to debug and review:
```{language}
{code}
```
"""


FREE_MODELS = [
    # Fast tier — tried first every time (not shuffled)
    "openai/gpt-oss-20b:free",
    "openai/gpt-oss-120b:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
    "deepseek/deepseek-chat:free",
    # Fallback pool — shuffled to spread rate-limit load
    "qwen/qwen3-coder:free",
    "qwen/qwen-2.5-coder-32b-instruct:free",
    "deepseek/deepseek-r1-distill-llama-70b:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "arcee-ai/trinity-large-preview:free",
    "nousresearch/hermes-3-llama-3.1-405b:free",
    "z-ai/glm-4.5-air:free",
    "stepfun/step-3.5-flash:free",
    "google/gemma-3-27b-it:free",
    "google/gemma-3-12b-it:free",
    "microsoft/phi-4:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
    "arcee-ai/trinity-mini:free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "nvidia/nemotron-nano-9b-v2:free",
    "qwen/qwen3-4b:free",
    "meta-llama/llama-3.2-3b-instruct:free",
]

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/review", methods=["POST"])
def review_code():
    data = request.get_json()
    code = data.get("code", "").strip()
    language = data.get("language", "Python").strip()

    if not code:
        return jsonify({"error": "No code provided."}), 400

    if len(code) > 5000:
        return jsonify({"error": "Code is too long. Please limit to 5000 characters."}), 400

    try:
        prompt = REVIEW_PROMPT.format(language=language, code=code)
        last_error = None
        raw_text = None

        # Keep fast tier in order; shuffle only the fallback pool
        fast_tier = FREE_MODELS[:5]
        fallback_pool = random.sample(FREE_MODELS[5:], len(FREE_MODELS[5:]))
        model_order = fast_tier + fallback_pool

        for model_id in model_order:
            try:
                response = client.chat.completions.create(
                    model=model_id,
                    messages=[{"role": "user", "content": prompt}],
                    timeout=20,
                )
                raw_text = response.choices[0].message.content.strip()
                break
            except Exception as model_err:
                err_str = str(model_err)
                last_error = model_err
                # Re-raise immediately on auth errors
                if "401" in err_str or "API_KEY" in err_str.upper() or "api key" in err_str.lower():
                    raise model_err
                # Skip silently on 404 (model not available) or 429 (rate-limited)
                if "404" in err_str or "No endpoints" in err_str:
                    continue
                if "429" in err_str or "rate" in err_str.lower() or "RESOURCE_EXHAUSTED" in err_str:
                    time.sleep(0.3)   # brief pause before trying next model
                    continue
                # For other transient errors, still try next model
                continue

        if raw_text is None:
            raise last_error

        # Strip <think>...</think> blocks (qwen3-coder and similar models)
        raw_text = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip()

        # Try to extract JSON: find the outermost { ... } block
        json_str = None
        brace_start = raw_text.find("{")
        if brace_start != -1:
            depth = 0
            for i, ch in enumerate(raw_text[brace_start:], start=brace_start):
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        json_str = raw_text[brace_start:i + 1]
                        break

        if json_str is None:
            fence_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", raw_text)
            if fence_match:
                json_str = fence_match.group(1).strip()
            else:
                json_str = raw_text

        # Fix invalid backslash escapes that appear when AI includes code in JSON
        # e.g. \s \d \w in regex inside a JSON string → must be \\s \\d \\w
        def fix_escapes(s):
            return re.sub(r'\\(?!["\\/ bfnrtu])', r'\\\\', s)

        try:
            result = json.loads(json_str)
        except json.JSONDecodeError:
            result = json.loads(fix_escapes(json_str))

        return jsonify(result)

    except json.JSONDecodeError as e:
        preview = (json_str or raw_text or "")[:200] if 'json_str' in locals() or 'raw_text' in locals() else ""
        return jsonify({"error": f"Failed to parse AI response. Please try again. (Hint: {str(e)})"}), 500
    except Exception as e:
        error_msg = str(e)
        if "API_KEY" in error_msg.upper() or "api key" in error_msg.lower() or "401" in error_msg:
            return jsonify({"error": "Invalid or missing OpenRouter API key. Please check your .env file."}), 500
        if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg or "rate" in error_msg.lower():
            return jsonify({"error": f"All {len(FREE_MODELS)} free models are currently rate-limited. Please wait 30–60 seconds and try again.", "retry_after": 30}), 429
        return jsonify({"error": f"AI service error: {error_msg}"}), 500


if __name__ == "__main__":
    app.run(debug=True)
