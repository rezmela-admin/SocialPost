import os
import time

from google import genai
from google.genai import types


def main():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("GEMINI_API_KEY environment variable not set")

    client = genai.Client(api_key=api_key)

    print("[veo3-test] Submitting sample job...")
    operation = client.models.generate_videos(
        model="veo-3.0-generate-preview",
        prompt="a close-up shot of a golden retriever playing in a field of sunflowers",
        config=types.GenerateVideosConfig(
            negative_prompt="barking, woofing",
        ),
    )

    while not operation.done:
        print("[veo3-test] Waiting for completion...")
        time.sleep(20)
        operation = client.operations.get(operation)

    print("[veo3-test] Downloading result...")
    generated_video = operation.result.generated_videos[0]
    client.files.download(file=generated_video.video)
    generated_video.video.save("veo3_sample.mp4")
    print("[veo3-test] Saved veo3_sample.mp4")
if __name__ == "__main__":
    main()
