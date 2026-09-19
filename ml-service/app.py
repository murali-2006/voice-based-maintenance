import os
import sys
import shutil
import tempfile
import time
from typing import Optional

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
MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
DEVICE = "cpu"
whisper_model = None

# Language mapping helpers
LANGUAGE_MAP = {
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
    "mr": "mr",
}

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
            {"code": "en-US", "name": "English", "whisper_code": "en"},
            {"code": "ta-IN", "name": "Tamil (தமிழ்)", "whisper_code": "ta"},
            {"code": "hi-IN", "name": "Hindi (हिन्दी)", "whisper_code": "hi"},
            {"code": "te-IN", "name": "Telugu (తెలుగు)", "whisper_code": "te"},
            {"code": "auto", "name": "Auto Detect", "whisper_code": None},
        ]
    }


@app.post("/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(None)
):
    try:
        model = load_whisper_model()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load Whisper model: {str(e)}")

    # Resolve Whisper language code
    whisper_lang = None
    if language:
        whisper_lang = LANGUAGE_MAP.get(language, language.lower().split("-")[0])
        if whisper_lang == "auto" or whisper_lang == "":
            whisper_lang = None

    # Save incoming audio stream to a temporary file
    suffix = os.path.splitext(audio.filename or "")[1]
    if not suffix:
        suffix = ".webm"

    temp_audio_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        content = await audio.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty audio file provided.")

        temp_audio_file.write(content)
        temp_audio_file.close()

        print(f"Processing audio ({len(content)} bytes), requested language: {whisper_lang}...")
        start_time = time.time()

        # 1. Transcribe in native language
        transcribe_args = {
            "task": "transcribe",
            "fp16": False,
            "beam_size": 1,
            "best_of": 1,
            "temperature": 0.0,
        }
        if whisper_lang:
            transcribe_args["language"] = whisper_lang

        transcribe_result = model.transcribe(temp_audio_file.name, **transcribe_args)
        detected_lang = transcribe_result.get("language", whisper_lang or "en")
        native_text = transcribe_result.get("text", "").strip()

        # 2. English translation (if original is non-English)
        if detected_lang == "en":
            english_text = native_text
        else:
            translate_args = {
                "task": "translate",
                "fp16": False,
                "beam_size": 1,
                "best_of": 1,
                "temperature": 0.0,
            }
            if whisper_lang:
                translate_args["language"] = whisper_lang
            translate_result = model.transcribe(temp_audio_file.name, **translate_args)
            english_text = translate_result.get("text", "").strip()

        processing_time = time.time() - start_time
        try:
            print(f"Completed in {processing_time:.2f}s. Language: {detected_lang}")
        except Exception:
            pass

        return {
            "success": True,
            "language": detected_lang,
            "transcription": native_text,
            "english_translation": english_text,
            "processing_time_seconds": round(processing_time, 2)
        }

    except Exception as e:
        print(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Audio processing error: {str(e)}")
    finally:
        if os.path.exists(temp_audio_file.name):
            try:
                os.unlink(temp_audio_file.name)
            except Exception:
                pass


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"Starting Whisper ML service on http://localhost:{port}...")
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
