
from PIL import Image
import os
src = r"D:\DSH\PassWordCreaterManager\brand\icon-512.png"
base = r"D:\DSH\PassWordCreaterManager\android\app\src\main\res"
img = Image.open(src).convert("RGBA")
for folder, size in [("mipmap-mdpi",48),("mipmap-hdpi",72),("mipmap-xhdpi",96),("mipmap-xxhdpi",144),("mipmap-xxxhdpi",192)]:
    d = os.path.join(base, folder)
    os.makedirs(d, exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
    print(folder, size)
