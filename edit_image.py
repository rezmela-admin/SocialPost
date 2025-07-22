# edit_image.py
import openai
import sys
import os
import base64
from io import BytesIO
from PIL import Image

# It's good practice to load the API key from an environment variable
openai.api_key = os.environ.get("OPENAI_API_KEY")
client = openai.OpenAI()

def edit_image_with_high_fidelity(input_path, output_path, prompt):
    """
    Edits an image with high fidelity using the gpt-image-1 model.
    """
    try:
        print(f"[PYTHON] Opening image from: {input_path}")
        with open(input_path, "rb") as image_file:
            result = client.images.edit(
                model="gpt-image-1",
                image=image_file,
                prompt=prompt,
                input_fidelity="high",
                n=1,
                size="1024x1024"
                # The API defaults to b64_json for gpt-image-1
            )

        print("[PYTHON] API call successful. Decoding image...")
        image_base64 = result.data[0].b64_json
        image_bytes = base64.b64decode(image_base64)
        
        # Use Pillow to open the image and save it, ensuring correct format
        final_image = Image.open(BytesIO(image_bytes))
        final_image.save(output_path, "PNG")
        
        print(f"[PYTHON] Successfully saved edited image to: {output_path}")
        return True

    except openai.APIError as e:
        print(f"[PYTHON_ERROR] OpenAI API Error: {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[PYTHON_ERROR] An unexpected error occurred: {e}", file=sys.stderr)
        return False

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python edit_image.py <input_image_path> <output_image_path> \"<prompt>\"", file=sys.stderr)
        sys.exit(1)

    input_path_arg = sys.argv[1]
    output_path_arg = sys.argv[2]
    prompt_arg = sys.argv[3]

    if not os.path.exists(input_path_arg):
        print(f"[PYTHON_ERROR] Input file not found: {input_path_arg}", file=sys.stderr)
        sys.exit(1)

    success = edit_image_with_high_fidelity(input_path_arg, output_path_arg, prompt_arg)
    
    if not success:
        sys.exit(1)
