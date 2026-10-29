
from PIL import Image
p = r"D:\DSH\PassWordCreaterManager\brand"
img = Image.open(p + r"\icon-512.png").convert("RGBA")
img.save(p + r"\icon.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print("ico ok", img.size)
