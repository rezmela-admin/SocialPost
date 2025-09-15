#!/usr/bin/env python3
"""
Generate narration audio from narration.json or narration.txt using
Gemini 2.5 Pro Preview TTS via the google-genai client (as per user's example).

Prereqs:
  pip install google-genai
  (optional) pip install python-dotenv  # to auto-load .env
  export GEMINI_API_KEY=...

Usage:
  python scripts/tts_from_narration.py --input outputs/<run>/narration.json --out outputs/<run>/narration.wav

Notes:
  - If the model returns raw PCM (e.g., audio/L16), this script wraps it into a WAV container.
  - Multi-speaker: If narration lines are in the form "Name: text", the script will configure
    per-speaker voice mapping automatically, cycling through a small list of prebuilt voices.
"""

import argparse
import base64
import json
import mimetypes
import os
import re
import struct
import sys
from typing import List, Dict

from google import genai
from google.genai import types

# Optional: auto-load .env if python-dotenv is available
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
except Exception:
    pass


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--input', '-i', required=True, help='Path to narration.json or narration.txt')
    p.add_argument('--out', '-o', required=False, help='Output audio file (default: <input_dir>/narration.wav)')
    p.add_argument('--model', default='gemini-2.5-pro-preview-tts', help='Gemini TTS model id')
    p.add_argument('--voices', default='', help='Comma-separated prebuilt voices to assign per speaker (e.g., Zephyr,Puck,Oriole)')
    p.add_argument('--temperature', type=float, default=1.0)
    return p.parse_args()


def esc(s: str) -> str:
    return s.replace('\n', ' ').strip()


def read_narration_text(narration_path: str) -> (str, List[str]):
    """Returns (joined_text, speakers) where speakers is a list of unique names found before ':'."""
    speakers: List[str] = []
    joined_lines: List[str] = []

    if narration_path.lower().endswith('.json'):
        with open(narration_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        segments = data.get('segments', [])
        for seg in segments:
            t = str(seg.get('text', '')).strip()
            if not t:
                continue
            joined_lines.append(t)
            m = re.match(r'^\s*([^:]{1,60}):\s*', t)
            if m:
                name = m.group(1).strip()
                if name and name not in speakers:
                    speakers.append(name)
    else:
        with open(narration_path, 'r', encoding='utf-8') as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue
                joined_lines.append(line)
                m = re.match(r'^\s*([^:]{1,60}):\s*', line)
                if m:
                    name = m.group(1).strip()
                    if name and name not in speakers:
                        speakers.append(name)

    return ('\n'.join(joined_lines), speakers)


def save_file(path: str, data: bytes):
    with open(path, 'wb') as f:
        f.write(data)
    print(f"[TTS] Saved: {path}")


def parse_audio_mime_type(mime_type: str) -> Dict[str, int]:
    # Defaults if parsing fails
    bits_per_sample = 16
    rate = 24000
    parts = (mime_type or '').split(';')
    for param in parts:
        param = param.strip()
        if param.lower().startswith('rate='):
            try:
                rate_str = param.split('=', 1)[1]
                rate = int(rate_str)
            except Exception:
                pass
        elif param.startswith('audio/L'):
            try:
                bits_per_sample = int(param.split('L', 1)[1])
            except Exception:
                pass
    return { 'bits_per_sample': bits_per_sample, 'rate': rate }


def convert_to_wav(audio_data: bytes, mime_type: str) -> bytes:
    params = parse_audio_mime_type(mime_type)
    bits_per_sample = int(params['bits_per_sample'])
    sample_rate = int(params['rate'])
    num_channels = 1
    data_size = len(audio_data)
    bytes_per_sample = bits_per_sample // 8
    block_align = num_channels * bytes_per_sample
    byte_rate = sample_rate * block_align
    chunk_size = 36 + data_size

    header = struct.pack(
        '<4sI4s4sIHHIIHH4sI',
        b'RIFF',
        chunk_size,
        b'WAVE',
        b'fmt ',
        16,
        1,
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b'data',
        data_size
    )
    return header + audio_data


def main():
    args = parse_args()

    inp = os.path.abspath(args.input)
    in_dir = os.path.dirname(inp)
    out_file = os.path.abspath(args.out) if args.out else os.path.join(in_dir, 'narration.wav')

    text, speakers = read_narration_text(inp)
    if not text:
        print('[TTS-ERROR] No narration text found.', file=sys.stderr)
        sys.exit(2)

    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print('[TTS-ERROR] GEMINI_API_KEY is not set.', file=sys.stderr)
        sys.exit(3)

    client = genai.Client(api_key=api_key)
    model = args.model

    # Build per-speaker voice configs (if any speakers were found)
    voice_cycle = [v.strip() for v in (args.voices.split(',') if args.voices else []) if v.strip()] or [
        'Zephyr', 'Puck', 'Oriole', 'Breeze'
    ]

    speaker_voice_configs: List[types.SpeakerVoiceConfig] = []
    for idx, spk in enumerate(speakers):
        voice_name = voice_cycle[idx % len(voice_cycle)]
        speaker_voice_configs.append(
            types.SpeakerVoiceConfig(
                speaker=spk,
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name)
                )
            )
        )

    contents = [
        types.Content(
            role='user',
            parts=[types.Part.from_text(text=f"Read aloud in a clear, engaging tone.\n{text}")]
        )
    ]

    generate_content_config = types.GenerateContentConfig(
        temperature=args.temperature,
        response_modalities=['audio'],
        speech_config=types.SpeechConfig(
            multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                speaker_voice_configs=speaker_voice_configs
            ) if speaker_voice_configs else None,
        ),
    )

    buffers: List[bytes] = []
    first_mime: str = ''

    for chunk in client.models.generate_content_stream(
        model=model,
        contents=contents,
        config=generate_content_config,
    ):
        c = getattr(chunk, 'candidates', None)
        if not c:
            continue
        cand = c[0]
        if not cand or not cand.content or not cand.content.parts:
            continue
        part = cand.content.parts[0]
        inline = getattr(part, 'inline_data', None)
        if inline and inline.data:
            if not first_mime:
                first_mime = inline.mime_type or ''
            buffers.append(inline.data)

    if not buffers:
        print('[TTS-ERROR] No audio data received from the model.', file=sys.stderr)
        sys.exit(4)

    audio_bytes = b''.join(buffers)
    ext = mimetypes.guess_extension(first_mime) or '.wav'
    out_path = out_file
    if not out_path.lower().endswith(ext):
        # If user provided a path without the proper extension, prefer guessed one
        base, _ = os.path.splitext(out_path)
        out_path = base + ext

    # If not a known container, wrap PCM into WAV
    if ext == '.wav':
        # If mime isn't specifically a wav type, we still wrap assuming PCM
        audio_bytes = convert_to_wav(audio_bytes, first_mime or 'audio/L16;rate=24000')

    save_file(out_path, audio_bytes)


if __name__ == '__main__':
    main()
