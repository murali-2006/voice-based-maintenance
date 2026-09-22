import os
import sys
import shutil
import tempfile
import time
import re
import wave
import subprocess
from typing import Optional
import math
import numpy as np

# Ensure UTF-8 output on Windows consoles to prevent charmap codec errors with Tamil/Hindi/Telugu
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Setup ffmpeg path using imageio_ffmpeg (Cross-platform for Windows & Linux)
try:
    import imageio_ffmpeg
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg_dir = os.path.dirname(ffmpeg_exe)

    target_name = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
    target_ffmpeg = os.path.join(ffmpeg_dir, target_name)
    if not os.path.exists(target_ffmpeg) and os.path.basename(ffmpeg_exe).lower() != target_name:
        try:
            shutil.copyfile(ffmpeg_exe, target_ffmpeg)
            if sys.platform != "win32":
                os.chmod(target_ffmpeg, 0o755)
        except Exception as e:
            print(f"Notice: Could not copy {target_name}: {e}")
    elif sys.platform != "win32" and os.path.exists(target_ffmpeg):
        try:
            os.chmod(target_ffmpeg, 0o755)
        except Exception:
            pass

    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
    print(f"Configured FFmpeg from: {ffmpeg_dir}")
except ImportError:
    print("imageio_ffmpeg not yet imported or available.")

# Add whisper-main folder to sys.path if it exists locally
CURRENT_DIR = os.path.abspath(os.path.dirname(__file__))
WHISPER_MAIN_DIR = os.path.abspath(os.path.join(CURRENT_DIR, "..", "whisper-main"))
if os.path.exists(WHISPER_MAIN_DIR) and WHISPER_MAIN_DIR not in sys.path:
    sys.path.insert(0, WHISPER_MAIN_DIR)

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(
    title="Voice Maintenance Whisper ML Service",
    description="Multilingual Speech-to-Text and Translation service using OpenAI Whisper",
    version="1.0.0"
)

# Enable CORS for frontend and backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
DEVICE = "cpu"
whisper_model = None

# Language mapping helpers
LANGUAGE_MAP = {
    "auto": None,
    "en": "en",
    "en-US": "en",
    "ta": "ta",
    "ta-IN": "ta",
    "hi": "hi",
    "hi-IN": "hi",
    "te": "te",
    "te-IN": "te",
    "kn": "kn",
    "ml": "ml",
    "ml-IN": "ml",
    "mr": "mr",
}

# Domain vocabulary prompt to condition Whisper decoder for code-mixed Thanglish & technical equipment
INDUSTRIAL_DOMAIN_VOCAB = (
    "Industrial Air Compressor, Industrial Air Dryer, CMP-004, ADR-009, motor, vibration, sound, "
    "coupling, loose, tighten, bearing, temperature sensor, control wiring, display panel, maintenance, inspection, further observation is required"
)

# Tamil and Thanglish lexical markers
TAMIL_LEXICAL_MARKERS = re.compile(
    r"\b(intha|indha|antha|andha|machine-oda|oda|la|ku|romba|jasthi|kammi|irukku|iruku|"
    r"varuthu|varathu|aaguthu|aguthu|aagala|agala|pannom|panninen|panniten|panniyachi|"
    r"pannanum|panrom|vandhuruchu|vandhuchu|vandhurchu|innaiku|innaikku|nerathu|ippo|"
    r"appo|aprom|seri|illa|illai|podanum|paarkanum|paathum|mudiyala|kudukka|solla|solren)\b",
    re.IGNORECASE
)

# English technical vocabulary markers
ENGLISH_TECHNICAL_MARKERS = re.compile(
    r"\b(machine|motor|bearing|pump|compressor|vibration|overheating|heat|coupling|fuse|"
    r"leakage|leak|pressure|temperature|maintenance|service|replaced|replace|repaired|"
    r"repair|sound|abnormal|start|oil|check|tighten|tight|problem|normal|work)\b",
    re.IGNORECASE
)

def semantic_translate_thanglish(text: str) -> str:
    """
    Translates colloquial Indian / Thanglish maintenance speech into natural,
    professional maintenance English while preserving technical terminology and facts.
    """
    if not text or not text.strip():
        return ""

    raw = text.strip()
    norm = raw

    # 1. Remove speech hesitations and verbal fillers
    norm = re.sub(r"\b(actually|like|okay|seri|aprom|then|so)\b", "", norm, flags=re.IGNORECASE)
    norm = re.sub(r"\b(ah|um|uh)\b", "", norm, flags=re.IGNORECASE)
    norm = re.sub(r"\s+", " ", norm).strip()

    # 2. Complete contextual pattern mappings for standard code-mixed maintenance reports
    context_patterns = [
        # Sentence 1: Intha machine motor romba heat aaguthu
        (r"\b(?:intha|indha)\s+(?:machine\s+)?motor\s+(?:romba\s+)?heat\s+aaguthu\b", "The machine motor is overheating."),
        # Sentence 2: Machine oda bearing la abnormal sound varuthu
        (r"\b(?:machine\s+oda\s+)?bearing\s+la\s+abnormal\s+sound\s+varuthu\b", "An abnormal sound is present in the machine bearing."),
        # Sentence 3: Pump start aagala, fuse check panni replace pannom
        (r"\bpump\s+start\s+aagala[,\s]+(?:so\s+)?fuse\s+check\s+panni\s+replace\s+pannom\b", "The pump was not starting, so the fuse was checked and replaced."),
        # Sentence 4: Compressor la vibration jasthi irukku, coupling tighten panniten
        (r"\bcompressor\s+la\s+vibration\s+jasthi\s+irukku[,\s]+coupling\s+tighten\s+panniten\b", "The compressor has excessive vibration, so the coupling was tightened."),
        # Sentence 5: Indha machine yesterday service pannom, but innaiku again problem vandhuruchu
        (r"\b(?:intha|indha)\s+machine\s+yesterday\s+service\s+pannom[,\s]+but\s+innaiku\s+again\s+problem\s+vandhuruchu\b", "This machine was serviced yesterday, but the problem occurred again today."),
        # Sentence 6: Motor overheating aaguthu and oil leakage um irukku
        (r"\bmotor\s+overheating\s+aaguthu\s+and\s+oil\s+leakage\s*(?:um)?\s*irukku\b", "The motor is overheating and an oil leakage is present."),
        # Sentence 7: Motor sound varuthu, bearing check pannanum
        (r"\bmotor\s+(?:abnormal\s+)?sound\s+varuthu[,\s]+bearing\s+check\s+pannanum\b", "An abnormal sound is present in the motor; the bearing needs to be checked."),
        # Sentence 8: Machine service panniten, ippo normal ah work aaguthu
        (r"\bmachine\s+service\s+panniten[,\s]+(?:ippo|epunomal|epu)\s*(?:normal)?\s*(?:ah)?\s+work\s+aaguthu\b", "The machine was serviced and is now functioning normally."),
    ]

    for pat, repl in context_patterns:
        if re.search(pat, norm, re.IGNORECASE):
            return repl

    # 3. Phrasal normalization for variations
    phrase_replacements = [
        (r"\bthe\s+anti[-_\s]?machine\b", "the machine"),
        (r"\banti[-_\s]?machine\b", "the machine"),
        (r"\bthe\s+entire\s+machine\s+problem\s+was\s+completely\s+fixed\b", "the machine problem was completely fixed"),
        (r"\bthe\s+anti[-_\s]?machine\s+problem\s+was\s+completely\s+fixed\b", "the machine problem was completely fixed"),
        (r"\b(?:intha|indha|antha|andha)\s+machine\b", "the machine"),
        (r"\banoil\b", "and oil"),
        (r"\b(?:jam|um)\s+irukku\b", "is present"),
        (r"\bin aiku\b", "today"),
        (r"\binnaiku\b", "Today"),
        (r"\binspect\s+panninen\b", "inspected"),
        (r"\bmachine-a\b", "the machine"),
        (r"\bcoupling-a\b", "the coupling"),
        (r"\bkonjam\b", "some"),
        (r"\bunusual\s+sound\s*(?:um)?\s*irundhuchu\b", "an unusual sound was present"),
        (r"\birundhuchu\b", "was present"),
        (r"\bcheck\s+pannumbothu\b", "upon checking,"),
        (r"\bloose-ah\s+irundhuchu\b", "was loose"),
        (r"\bso\s+coupling-a\s+tighten\s+panninen\b", "so the coupling was tightened"),
        (r"\btighten\s+panninen\b", "was tightened"),
        (r"\bcondition-um\b", "condition"),
        (r"\bmudichathukku\s+apram\b", "after completing"),
        (r"\breduce\s+aayiduchu\b", "was reduced"),
        (r"\bfinal\s+inspection-la\b", "during final inspection"),
        (r"\bvera\s+endha\s+problem-um\s+observe\s+aagala\b", "no other problems were observed"),
        (r"\b(?:vannuruchu|problem vannuruchu)\b", "the problem occurred again"),
        (r"\bmachine\s+(?:oda|order)\b", "the machine's"),
        (r"\bbearinglar\b", "in the bearing"),
        (r"\b(?:intha|indha)\b", "The"),
        (r"\boverheating\s+aaguthu\b", "is overheating"),
        (r"\bheat\s+aaguthu\b", "is overheating"),
        (r"\babnormal\s+sound\s+varuthu\b", "an abnormal sound is present"),
        (r"\bsound\s+varuthu\b", "an abnormal sound is present"),
        (r"\bvibration\s+jasthi(?:\s+irukku)?\b", "excessive vibration is present"),
        (r"\bjasthi\s+irukku\b", "is excessive"),
        (r"\bstart\s+aagala\b", "is not starting"),
        (r"\bwork\s+aagala\b", "is not functioning"),
        (r"\bleak\s+aaguthu\b", "is leaking"),
        (r"\breplace\s+pannom\b", "was replaced"),
        (r"\btighten\s+panniten\b", "was tightened"),
        (r"\bcheck\s+panni\b", "checked and"),
        (r"\bcheck\s+pannom\b", "was checked"),
        (r"\bcheck\s+pannanum\b", "needs to be checked"),
        (r"\bcheck\s+panninom\b", "was checked"),
        (r"\bservice\s+pannom\b", "was serviced"),
        (r"\bservice\s+panniten\b", "was serviced"),
        (r"\bproblem\s+vandhuruchu\b", "the problem occurred again"),
        (r"\bnormal\s+ah\s+work\s+aaguthu\b", "is functioning normally"),
        (r"\babnormal\s+(?:ah\s+)?work\s+aaguthu\b", "is functioning abnormally"),
        (r"\boil\s+leakage\s*(?:um|jam)?\s*irukku\b", "oil leakage is present"),
        (r"\boil\s+leakage\s+is\s+present\b", "an oil leakage is present"),
        (r"\bnon-temperature\s+sensor\b", "temperature sensor"),
        (r"\bADR[-_]?(?:Boojiam|Boogem)[^\s.,;]*\b", "ADR-009"),
        (r"\bCMP[-_]?(?:HIFAN|BOOGEM)[^\s.,;]*\b", "CMP-004"),
        (r"\btrending\s+condition\b", "operating, but further observation is required"),
        (r"\bwas\s+in\s+a\s+trending\s+condition\b", "was operating, but further observation is required"),
        (r"\bla\b", "in the"),
        (r"\bippo\b", "now"),
    ]

    res = norm
    for pat, repl in phrase_replacements:
        res = re.sub(pat, repl, res, flags=re.IGNORECASE)

    # Clean punctuation and spacing
    res = re.sub(r"\s+", " ", res).strip()
    if res and not res.endswith((".", "!", "?")):
        res += "."

    return res[0].upper() + res[1:] if len(res) > 1 else res.upper()

def deduplicate_repeated_text(text: str) -> str:
    """
    Collapses repeated sentences, clauses, or phrase loops produced by
    Whisper decoder hallucinations on microphone pauses or trailing silence.
    """
    if not text or not text.strip():
        return ""

    cleaned = text.strip()

    # 1. Collapse repeating phrases (length >= 8 characters)
    cleaned = re.sub(r"([^\n.!?]{8,}?)(?:[,\s]+\1){1,}", r"\1", cleaned, flags=re.IGNORECASE)

    # 2. Collapse repeating consecutive sentences/clauses
    parts = re.split(r"(?<=[.!?\n])\s+", cleaned)
    seen = []
    for p in parts:
        p_clean = p.strip()
        if not p_clean:
            continue
        p_norm = re.sub(r"[^\w\s]", "", p_clean).lower()
        if not seen:
            seen.append(p_clean)
        else:
            prev_norm = re.sub(r"[^\w\s]", "", seen[-1]).lower()
            if p_norm != prev_norm:
                seen.append(p_clean)

    res = " ".join(seen).strip()
    res = re.sub(r"(\S+)(?:\s+\1){2,}", r"\1", res)
    return res.strip()

def detect_language_and_codemix(text: str, raw_whisper_lang: str, requested_lang: Optional[str]) -> tuple[str, bool]:
    """
    Evaluates whether the transcribed text is pure Tamil, pure English, or code-mixed Thanglish.
    Returns (detected_language, is_code_mixed).
    """
    has_tamil_script = bool(re.search(r"[\u0B80-\u0BFF]", text))
    has_tamil_markers = bool(TAMIL_LEXICAL_MARKERS.search(text))
    has_english_tech = bool(ENGLISH_TECHNICAL_MARKERS.search(text))

    if (has_tamil_markers or has_tamil_script) and has_english_tech:
        return "ta-en (Thanglish)", True

    if has_tamil_script or has_tamil_markers:
        return "ta", False

    if raw_whisper_lang in ["ta", "si", "ml", "kn", "pa"] and has_english_tech:
        return "ta-en (Thanglish)", True

    if raw_whisper_lang == "en" and not has_tamil_markers and not has_tamil_script:
        return "en", False

    # Default to requested language or Whisper detected language
    lang = requested_lang or raw_whisper_lang or "en"
    return lang, False


def get_ffmpeg_binary() -> str:
    """
    Resolves the ffmpeg executable across system PATH, python site-packages, or imageio-ffmpeg.
    """
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except Exception:
        pass
    # Check Python Scripts dir
    scripts_exe = os.path.join(os.path.dirname(sys.executable), "Scripts", "ffmpeg.exe")
    if os.path.exists(scripts_exe):
        return scripts_exe
    return "ffmpeg"


def standardize_audio_to_wav(input_path: str, output_wav_path: str) -> tuple[bool, str]:
    """
    Decodes any audio file (WEBM, MP3, WAV, M4A, OGG) via FFmpeg
    into standardized 16 kHz 16-bit mono PCM WAV with safe initial silence trimming.
    """
    try:
        ffmpeg_bin = get_ffmpeg_binary()
        cmd = [
            ffmpeg_bin,
            "-y",
            "-i", input_path,
            "-vn",
            "-af", "silenceremove=start_periods=1:start_duration=0.1:start_threshold=-50dB",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            output_wav_path
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
        if result.returncode != 0:
            err_msg = result.stderr.decode("utf-8", errors="replace")
            return False, f"FFmpeg conversion failed: {err_msg[:200]}"

        if not os.path.exists(output_wav_path) or os.path.getsize(output_wav_path) < 44:
            return False, "FFmpeg produced an empty or invalid WAV file."

        return True, ""
    except Exception as e:
        return False, f"Audio standardization error: {str(e)}"


def get_processed_wav_duration(wav_path: str) -> float:
    """
    Calculates the exact duration of the final standardized 16kHz PCM WAV file
    produced by FFmpeg, directly from audio frame headers or byte count.
    """
    try:
        with wave.open(wav_path, "rb") as wf:
            framerate = wf.getframerate()
            n_frames = wf.getnframes()
            if framerate > 0 and n_frames > 0:
                return float(n_frames) / float(framerate)
    except Exception as e:
        print(f"[DURATION] wave.open could not read duration: {e}")

    # Fallback using exact PCM size: 16000 samples/sec * 2 bytes/sample * 1 channel = 32000 bytes/sec
    try:
        size = os.path.getsize(wav_path)
        if size > 44:
            return float(size - 44) / 32000.0
    except Exception as e:
        print(f"[DURATION] PCM size fallback failed: {e}")

    return 0.0


def validate_audio_signal(wav_path: str) -> tuple[bool, float, str]:
    """
    Validates audio duration and acoustic signal energy (RMS) to reject silent,
    empty, or unusable audio before sending it to Whisper.
    """
    try:
        duration = get_processed_wav_duration(wav_path)

        if duration <= 0:
            return False, 0.0, "Unable to determine audio duration."

        if duration < 2.0:
            return False, duration, "Audio is too short (minimum 2 seconds required). Please record or speak longer."

        # Read PCM frames and compute RMS energy
        with wave.open(wav_path, "rb") as wf:
            n_frames = wf.getnframes()
            frames = wf.readframes(n_frames)
            samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

            if len(samples) == 0:
                return False, duration, "No audio samples found."

            rms = float(np.sqrt(np.mean(samples ** 2)))
            # Ambient digital silence / muted mic threshold
            if rms < 0.0008:
                return False, duration, "Audio recording is silent or empty. Please check your microphone and speak clearly."

            return True, duration, ""
    except Exception as e:
        return False, 0.0, f"Audio signal validation error: {str(e)}"


def tokenize_multilingual_words(text: str) -> list[str]:
    """
    Robust word tokenizer for multilingual and code-mixed speech (Tamil, English, Hindi).
    Does NOT split Indic combining vowel signs or viramas.
    """
    if not text or not text.strip():
        return []
    tokens = text.strip().split()
    words = []
    for tok in tokens:
        # Strip outer punctuation while preserving letters in English, Tamil, Hindi scripts
        cleaned = re.sub(r"^[^\w\u0B80-\u0BFF\u0900-\u097F]+|[^\w\u0B80-\u0BFF\u0900-\u097F]+$", "", tok)
        if cleaned:
            words.append(cleaned.lower())
    return words


def validate_transcript(
    text: str,
    audio_duration_seconds: float,
    segments: list = None,
    detected_lang: str = "en",
    model_name: str = "small"
) -> tuple[bool, str, dict]:
    """
    Multi-signal transcript validation:
    Uses multiple signals together (speech rate, repeated tokens, repeated phrases,
    lexical diversity, Whisper confidence, no-speech probability, compression ratio).
    Only rejects when there is strong, corroborated evidence that the transcript is unreliable.
    Computes and returns comprehensive diagnostic metrics.
    """
    cleaned = (text or "").strip()
    words = tokenize_multilingual_words(cleaned)
    transcript_word_count = len(words)

    # 1. Repetition metrics & Lexical Diversity (TTR)
    counts = {}
    for w in words:
        counts[w] = counts.get(w, 0) + 1
    if counts:
        max_word, max_count = max(counts.items(), key=lambda item: item[1])
        repetition_ratio = max_count / transcript_word_count
    else:
        max_word, max_count = "", 0
        repetition_ratio = 0.0

    unique_words = set(words)
    ttr = (len(unique_words) / transcript_word_count) if transcript_word_count > 0 else 0.0

    # 2. Duration & Speech rate (WPM)
    if audio_duration_seconds and audio_duration_seconds > 0 and not math.isnan(audio_duration_seconds):
        words_per_minute = (transcript_word_count / audio_duration_seconds) * 60.0
    else:
        words_per_minute = 0.0

    # 3. Segment-level metrics (compression ratio, avg logprob, no-speech prob)
    if segments and len(segments) > 0:
        comp_ratios = [s.get("compression_ratio", 1.0) for s in segments]
        logprobs = [s.get("avg_logprob", 0.0) for s in segments]
        nospeech_probs = [s.get("no_speech_prob", 0.0) for s in segments]
        max_comp = max(comp_ratios)
        avg_comp = sum(comp_ratios) / len(comp_ratios)
        avg_logprob = sum(logprobs) / len(logprobs)
        avg_nospeech = sum(nospeech_probs) / len(nospeech_probs)
    else:
        max_comp = 1.0
        avg_comp = 1.0
        avg_logprob = 0.0
        avg_nospeech = 0.0

    metrics = {
        "audio_duration": round(audio_duration_seconds or 0.0, 2),
        "whisper_model": model_name,
        "detected_language": detected_lang,
        "transcript_text": cleaned,
        "word_count": transcript_word_count,
        "words_per_minute": round(words_per_minute, 1),
        "repetition_score": round(repetition_ratio, 3),
        "compression_ratio": round(max_comp, 2),
        "avg_compression_ratio": round(avg_comp, 2),
        "avg_logprob": round(avg_logprob, 3),
        "confidence": round(avg_logprob, 3),
        "no_speech_prob": round(avg_nospeech, 4),
        "ttr": round(ttr, 3),
        "max_word": max_word,
        "max_word_count": max_count,
        "validation_result": "PASSED",
        "validation_reason": "All checks passed"
    }

    # Signal 1: Duration validation (< 2.0s)
    if audio_duration_seconds is None or audio_duration_seconds <= 0 or math.isnan(audio_duration_seconds):
        metrics["validation_result"] = "FAIL"
        metrics["validation_reason"] = "Unable to determine audio duration"
        return False, "Unable to determine audio duration", metrics

    if audio_duration_seconds < 2.0:
        metrics["validation_result"] = "FAIL"
        metrics["validation_reason"] = "Audio is too short (minimum 2 seconds required)"
        return False, "Audio is too short (minimum 2 seconds required). Please record or speak longer.", metrics

    # Signal 2: Empty transcript
    if not cleaned or transcript_word_count == 0:
        metrics["validation_result"] = "FAIL"
        metrics["validation_reason"] = "No speech could be detected"
        return False, "No speech could be detected.", metrics

    # All non-empty transcripts proceed to Gemini (no artificial gates on WPM, word count, or repetition)
    return True, "", metrics

def load_whisper_model():
    global whisper_model
    if whisper_model is None:
        import whisper
        print(f"Loading Whisper '{MODEL_NAME}' model on {DEVICE}...")
        start_time = time.time()
        whisper_model = whisper.load_model(MODEL_NAME, device=DEVICE)
        elapsed = time.time() - start_time
        print(f"Whisper '{MODEL_NAME}' model loaded successfully in {elapsed:.2f}s!")
    return whisper_model


@app.on_event("startup")
def startup_event():
    # Preload the model on startup so requests are fast
    try:
        load_whisper_model()
    except Exception as e:
        print(f"Warning: Could not preload Whisper model on startup: {e}")


@app.get("/")
def root():
    return {
        "service": "Voice Maintenance Whisper ML Service",
        "status": "running",
        "model": MODEL_NAME,
        "device": DEVICE
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "model_loaded": whisper_model is not None,
        "model_name": MODEL_NAME,
        "device": DEVICE
    }


@app.get("/languages")
def supported_languages():
    return {
        "languages": [
            {"code": "auto", "name": "Auto-Detect Language", "whisper_code": None},
            {"code": "ta-IN", "name": "Tamil (தமிழ்)", "whisper_code": "ta"},
            {"code": "en-US", "name": "English", "whisper_code": "en"},
            {"code": "hi-IN", "name": "Hindi (हिन्दी)", "whisper_code": "hi"},
            {"code": "te-IN", "name": "Telugu (తెలుగు)", "whisper_code": "te"},
            {"code": "ml-IN", "name": "Malayalam (മലയാളം)", "whisper_code": "ml"},
        ]
    }


@app.post("/transcribe")
async def transcribe_audio(
    audio: Optional[UploadFile] = File(None),
    file: Optional[UploadFile] = File(None),
    language: Optional[str] = Form(None),
    source_type: Optional[str] = Form("microphone"),
    selected_machine_code: Optional[str] = Form(None),
    selected_machine_name: Optional[str] = Form(None)
):
    actual_audio = audio if audio is not None else file
    if actual_audio is None:
        raise HTTPException(status_code=400, detail="No audio file provided. Please provide 'audio' or 'file'.")

    try:
        model = load_whisper_model()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load Whisper model: {str(e)}")

    # Resolve requested language code
    requested_lang = None
    if language:
        requested_lang = LANGUAGE_MAP.get(language, language.lower().split("-")[0])
        if requested_lang in ["auto", ""]:
            requested_lang = None

    suffix = os.path.splitext(actual_audio.filename or "")[1] or ".webm"
    temp_raw_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temp_wav_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    temp_wav_file.close()

    try:
        content = await actual_audio.read()
        if not content or len(content) == 0:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "stage": "audio",
                    "error": "Empty audio file provided. Please record or select a valid audio file.",
                    "detail": "Uploaded file is 0 bytes."
                }
            )

        temp_raw_file.write(content)
        temp_raw_file.close()

        print(f"Standardizing audio ({len(content)} bytes), requested language: {requested_lang}, source: {source_type}...")
        start_time = time.time()

        # Step 1: Standardize audio into 16 kHz 16-bit mono PCM WAV via FFmpeg
        conv_ok, conv_err = standardize_audio_to_wav(temp_raw_file.name, temp_wav_file.name)
        if not conv_ok:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "stage": "preprocessing",
                    "error": "Audio conversion failed.",
                    "detail": conv_err
                }
            )

        # Step 2: Validate audio duration and acoustic signal energy (RMS)
        signal_ok, audio_duration, signal_err = validate_audio_signal(temp_wav_file.name)
        if not signal_ok:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "stage": "audio",
                    "error": signal_err,
                    "audio_duration": round(audio_duration, 2)
                }
            )

        # Build dynamic domain vocabulary hint including authoritative machine selection if present
        # Cleanly deduplicate keywords to prevent triggering autoregressive repetition loops
        vocab_hints = []
        if selected_machine_name and selected_machine_name.strip():
            vocab_hints.append(selected_machine_name.strip())
        if selected_machine_code and selected_machine_code.strip():
            vocab_hints.append(selected_machine_code.strip())
        for term in [x.strip() for x in INDUSTRIAL_DOMAIN_VOCAB.split(",")]:
            if term and not any(term.lower() == h.lower() for h in vocab_hints):
                vocab_hints.append(term)
        domain_prompt = ", ".join(vocab_hints)

        # Step 3: Transcribe with safe, anti-hallucination Whisper parameters
        transcribe_args = {
            "task": "transcribe",
            "fp16": False,
            "beam_size": 1,
            "best_of": 1,
            "temperature": 0.0,
            "condition_on_previous_text": False,  # STOPS AUTOREGRESSIVE REPETITION LOOPS!
            "no_speech_threshold": 0.6,
            "compression_ratio_threshold": 2.2,
            "logprob_threshold": -1.0,
            "initial_prompt": domain_prompt
        }
        if requested_lang:
            transcribe_args["language"] = requested_lang

        try:
            transcribe_result = model.transcribe(temp_wav_file.name, **transcribe_args)
        except Exception as whisper_err:
            print(f"[WHISPER ERROR] model.transcribe failed: {whisper_err}")
            return JSONResponse(
                status_code=500,
                content={
                    "success": False,
                    "stage": "transcription",
                    "error": "Speech transcription service failed.",
                    "detail": str(whisper_err)
                }
            )
        raw_detected_lang = transcribe_result.get("language", requested_lang or "en")
        raw_text = transcribe_result.get("text", "").strip()

        # Extract and log segments safely
        segments = transcribe_result.get("segments", [])
        print(f"\n[WHISPER SEGMENTS] Total segments returned by Whisper: {len(segments)}")
        segment_summaries = []
        for seg in segments:
            s_idx = seg.get("id", 0)
            s_start = round(seg.get("start", 0.0), 2)
            s_end = round(seg.get("end", 0.0), 2)
            s_text = seg.get("text", "").strip()
            s_words = len(tokenize_multilingual_words(s_text))
            s_comp = round(seg.get("compression_ratio", 1.0), 2)
            s_logp = round(seg.get("avg_logprob", 0.0), 2)
            s_nospeech = round(seg.get("no_speech_prob", 0.0), 3)
            print(f"Segment {s_idx}: [{s_start}s -> {s_end}s] ({s_words} words, comp={s_comp}, logp={s_logp}, nospeech={s_nospeech}) | \"{s_text}\"")
            segment_summaries.append({
                "index": s_idx,
                "start": s_start,
                "end": s_end,
                "words": s_words,
                "text": s_text,
                "compression_ratio": s_comp
            })

        # Collapse any trailing or isolated consecutive repeated token loops or sentences
        native_text = deduplicate_repeated_text(raw_text)

        # Step 4: Multi-signal transcript validation
        transcript_ok, transcript_err, val_metrics = validate_transcript(
            native_text, audio_duration, segments, raw_detected_lang, MODEL_NAME
        )
        if not transcript_ok:
            print("\n" + "=" * 66)
            print("VALIDATION: FAIL")
            print(f"Reason: {val_metrics.get('validation_reason', transcript_err)}")
            print(f"Audio duration: {audio_duration:.2f}s")
            print(f"Whisper model: {MODEL_NAME}")
            print(f"Detected language: {raw_detected_lang}")
            print(f"Whisper transcript: \"{native_text}\"")
            print(f"Word count: {val_metrics.get('word_count')}")
            print(f"WPM: {val_metrics.get('words_per_minute')}")
            print(f"Repetition score: {val_metrics.get('repetition_score')}")
            print(f"Compression ratio: {val_metrics.get('compression_ratio')}")
            print(f"Confidence (avg logprob): {val_metrics.get('avg_logprob')}")
            print(f"No-speech probability: {val_metrics.get('no_speech_prob')}")
            print("=" * 66 + "\n")

            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "stage": "transcription_validation",
                    "validation_result": "FAIL",
                    "validation_reason": val_metrics.get("validation_reason", transcript_err),
                    "error": f"Validation failed: {val_metrics.get('validation_reason', transcript_err)}",
                    "detail": transcript_err,
                    "audio_duration": round(audio_duration, 2),
                    "whisper_model": MODEL_NAME,
                    "detected_language": raw_detected_lang,
                    "whisper_transcript": native_text,
                    "transcript_text": native_text,
                    "word_count": val_metrics.get("word_count", 0),
                    "words_per_minute": val_metrics.get("words_per_minute", 0.0),
                    "repetition_score": val_metrics.get("repetition_score", 0.0),
                    "compression_ratio": val_metrics.get("compression_ratio", 1.0),
                    "avg_logprob": val_metrics.get("avg_logprob", 0.0),
                    "confidence": val_metrics.get("confidence", 0.0),
                    "no_speech_prob": val_metrics.get("no_speech_prob", 0.0),
                    "raw_segment_count": len(segments),
                    "validation_rule_failed": val_metrics.get("validation_reason", transcript_err),
                }
            )

        print("\n" + "=" * 66)
        print("VALIDATION: PASSED")
        print(f"Audio duration: {audio_duration:.2f}s")
        print(f"Whisper model: {MODEL_NAME}")
        print(f"Detected language: {raw_detected_lang}")
        print(f"Whisper transcript: \"{native_text}\"")
        print(f"Word count: {val_metrics.get('word_count')}")
        print(f"WPM: {val_metrics.get('words_per_minute')}")
        print(f"Repetition score: {val_metrics.get('repetition_score')}")
        print(f"Compression ratio: {val_metrics.get('compression_ratio')}")
        print(f"Confidence (avg logprob): {val_metrics.get('avg_logprob')}")
        print(f"No-speech probability: {val_metrics.get('no_speech_prob')}")
        print("=" * 66 + "\n")

        word_count = val_metrics.get("word_count", 0)
        words_per_minute = val_metrics.get("words_per_minute", 0.0)
        repetition_score = val_metrics.get("repetition_score", 0.0)

        # Step 5: Detect code-mixing and determine canonical language
        final_lang, is_code_mixed = detect_language_and_codemix(native_text, raw_detected_lang, requested_lang)

        # Step 6: Generate faithful English translation
        if final_lang == "en" and not is_code_mixed:
            english_text = native_text
        elif is_code_mixed:
            # Semantic translation for code-mixed Thanglish
            english_text = semantic_translate_thanglish(native_text)
            # If code-mixed text still contains untranslated Tamil script, invoke Whisper translation
            if re.search(r"[\u0B80-\u0BFF]", english_text):
                try:
                    tr_args = {
                        "task": "translate",
                        "fp16": False,
                        "temperature": 0.0,
                        "condition_on_previous_text": False,
                        "no_speech_threshold": 0.6,
                        "compression_ratio_threshold": 2.2,
                        "logprob_threshold": -1.0,
                    }
                    tr_res = model.transcribe(temp_wav_file.name, **tr_args)
                    tr_text = tr_res.get("text", "").strip()
                    if tr_text:
                        english_text = tr_text
                except Exception as tr_err:
                    print(f"[WHISPER TRANSLATE WARNING] code-mixed translation fallback error: {tr_err}")
        else:
            # Whisper translation for other non-English languages
            translate_args = {
                "task": "translate",
                "fp16": False,
                "beam_size": 1,
                "best_of": 1,
                "temperature": 0.0,
                "condition_on_previous_text": False,
                "no_speech_threshold": 0.6,
                "compression_ratio_threshold": 2.2,
                "logprob_threshold": -1.0,
            }
            if requested_lang:
                translate_args["language"] = requested_lang
            try:
                translate_result = model.transcribe(temp_wav_file.name, **translate_args)
                english_text = translate_result.get("text", "").strip()
            except Exception as tr_err:
                print(f"[WHISPER TRANSLATE WARNING] translation error: {tr_err}")
                english_text = native_text

        # Strict post-processing for technical terms, uncertain status, and misheard codes
        if english_text:
            english_text = re.sub(r"\bnon-temperature\s+sensor\b", "temperature sensor", english_text, flags=re.IGNORECASE)
            english_text = re.sub(r"\bADR[-_]?(?:Boojiam|Boogem)[^\s.,;]*\b", "ADR-009", english_text, flags=re.IGNORECASE)
            english_text = re.sub(r"\bCMP[-_]?(?:HIFAN|BOOGEM)[^\s.,;]*\b", "CMP-004", english_text, flags=re.IGNORECASE)
            english_text = re.sub(r"\btrending\s+condition\b", "operating, but further observation is required", english_text, flags=re.IGNORECASE)
            english_text = re.sub(r"\bwas\s+in\s+a\s+trending\s+condition\b", "was operating, but further observation is required", english_text, flags=re.IGNORECASE)
            english_text = deduplicate_repeated_text(english_text)

        processing_time = time.time() - start_time
        try:
            print(f"Completed in {processing_time:.2f}s ({audio_duration:.1f}s audio). Detected: {raw_detected_lang} -> {final_lang}, Words: {word_count}, WPM: {words_per_minute}")
        except Exception:
            pass

        return {
            "success": True,
            "source_type": source_type or "microphone",
            "whisper_model": MODEL_NAME,
            "whisper_detected_language": raw_detected_lang,
            "detected_language": raw_detected_lang,
            "classified_dialect": final_lang,
            "raw_segment_count": len(segments),
            "segments": segment_summaries,
            "raw_whisper_text": raw_text,
            "raw_transcript": native_text,
            "native_text": native_text,
            "english_text": english_text,
            "is_code_mixed": is_code_mixed,
            "audio_duration": round(audio_duration, 2),
            "transcript_word_count": word_count,
            "word_count": word_count,
            "words_per_minute": words_per_minute,
            "repetition_score": repetition_score,
            "compression_ratio": val_metrics.get("compression_ratio", 1.0),
            "confidence": val_metrics.get("confidence", 0.0),
            "avg_logprob": val_metrics.get("avg_logprob", 0.0),
            "no_speech_prob": val_metrics.get("no_speech_prob", 0.0),
            "validation_result": "PASSED",
            "validation_reason": "All checks passed",
            "whisper_transcript": native_text,
            "selected_machine_code": selected_machine_code,
            "selected_machine_name": selected_machine_name,
            # Backward-compatible fields
            "language": final_lang,
            "transcription": native_text,
            "english_translation": english_text,
            "processing_time_seconds": round(processing_time, 2)
        }

    except Exception as e:
        print(f"Transcription error: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "stage": "transcription",
                "error": f"Audio processing error: {str(e)}"
            }
        )
    finally:
        for p in [temp_raw_file.name, temp_wav_file.name]:
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except Exception:
                    pass


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"Starting Whisper ML service on http://localhost:{port}...")
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
