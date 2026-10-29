import os
import base64
from PIL import Image, ImageDraw, ImageFont

# Path to the source shield cutout
shield_path = r'c:\Users\Admin\Desktop\OnaPolisi\shield-cutout-aa.png'
shield = Image.open(shield_path).convert('RGBA')

with open(shield_path, 'rb') as f:
    shield_b64 = base64.b64encode(f.read()).decode('utf-8')

# 1. Generate logo.svg
logo_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 54" width="220" height="54" fill="none">
  <image href="data:image/png;base64,{shield_b64}" x="4" y="4" width="34" height="46" preserveAspectRatio="xMidYMid meet" />
  <text x="46" y="34" font-family="Plus Jakarta Sans, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="800" fill="#0F1419" letter-spacing="-0.03em">Ona Polisi</text>
</svg>"""

with open(r'c:\Users\Admin\Desktop\OnaPolisi\logo.svg', 'w', encoding='utf-8') as f:
    f.write(logo_svg)
print("Saved logo.svg")

# 2. Generate logo-white.svg
logo_white_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 54" width="220" height="54" fill="none">
  <image href="data:image/png;base64,{shield_b64}" x="4" y="4" width="34" height="46" preserveAspectRatio="xMidYMid meet" />
  <text x="46" y="34" font-family="Plus Jakarta Sans, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="800" fill="#FFFFFF" letter-spacing="-0.03em">Ona Polisi</text>
</svg>"""

with open(r'c:\Users\Admin\Desktop\OnaPolisi\logo-white.svg', 'w', encoding='utf-8') as f:
    f.write(logo_white_svg)
print("Saved logo-white.svg")

# 3. Generate logo-icon.svg
logo_icon_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 54 54" width="54" height="54" fill="none">
  <image href="data:image/png;base64,{shield_b64}" x="5" y="4" width="44" height="46" preserveAspectRatio="xMidYMid meet" />
</svg>"""

with open(r'c:\Users\Admin\Desktop\OnaPolisi\logo-icon.svg', 'w', encoding='utf-8') as f:
    f.write(logo_icon_svg)
print("Saved logo-icon.svg")

# 4. Generate high-res logo.png (880x216, supersampled 4x)
scale = 4
lw, lh = 220 * scale, 54 * scale
logo_img = Image.new('RGBA', (lw, lh), (0, 0, 0, 0))
target_sh_h = int(46 * scale)
target_sh_w = int(round(shield.width * (target_sh_h / shield.height)))
scaled_sh = shield.resize((target_sh_w, target_sh_h), Image.Resampling.LANCZOS)
logo_img.paste(scaled_sh, (int(6 * scale), int(4 * scale)), scaled_sh)

draw = ImageDraw.Draw(logo_img)
font = None
font_names = ["segoeuib.ttf", "arialbd.ttf", "calibrib.ttf", "arial.ttf"]
for fn in font_names:
    try:
        font = ImageFont.truetype(fn, int(22 * scale))
        break
    except Exception:
        continue
if font is None:
    font = ImageFont.load_default()

draw.text((int(46 * scale), int(14 * scale)), "Ona Polisi", font=font, fill=(15, 20, 25, 255))
logo_final = logo_img.resize((440, 108), Image.Resampling.LANCZOS)
logo_final.save(r'c:\Users\Admin\Desktop\OnaPolisi\logo.png')
print("Saved logo.png")

# 5. Generate high-res logo-white.png
logo_white_img = Image.new('RGBA', (lw, lh), (0, 0, 0, 0))
logo_white_img.paste(scaled_sh, (int(6 * scale), int(4 * scale)), scaled_sh)
draw_w = ImageDraw.Draw(logo_white_img)
draw_w.text((int(46 * scale), int(14 * scale)), "Ona Polisi", font=font, fill=(255, 255, 255, 255))
logo_white_final = logo_white_img.resize((440, 108), Image.Resampling.LANCZOS)
logo_white_final.save(r'c:\Users\Admin\Desktop\OnaPolisi\logo-white.png')
print("Saved logo-white.png")

# 6. Favicons
# 16x16 favicon
fav16 = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
target_h = 15
target_w = int(round(shield.width * (target_h / shield.height)))
scaled_16 = shield.resize((target_w, target_h), Image.Resampling.LANCZOS)
fav16.paste(scaled_16, ((16 - target_w) // 2, (16 - target_h) // 2), scaled_16)
fav16.save(r'c:\Users\Admin\Desktop\OnaPolisi\favicon-16.png')
print("Saved favicon-16.png")

# 32x32 favicon
fav32 = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
target_h = 30
target_w = int(round(shield.width * (target_h / shield.height)))
scaled_32 = shield.resize((target_w, target_h), Image.Resampling.LANCZOS)
fav32.paste(scaled_32, ((32 - target_w) // 2, (32 - target_h) // 2), scaled_32)
fav32.save(r'c:\Users\Admin\Desktop\OnaPolisi\favicon.png')
print("Saved favicon.png")

# 180x180 apple touch icon
fav_apple = Image.new('RGBA', (180, 180), (0, 0, 0, 0))
target_h = 168
target_w = int(round(shield.width * (target_h / shield.height)))
scaled_apple = shield.resize((target_w, target_h), Image.Resampling.LANCZOS)
fav_apple.paste(scaled_apple, ((180 - target_w) // 2, (180 - target_h) // 2), scaled_apple)
fav_apple.save(r'c:\Users\Admin\Desktop\OnaPolisi\apple-touch-icon.png')
print("Saved apple-touch-icon.png")

# 192x192 favicon (Android PWA)
fav192 = Image.new('RGBA', (192, 192), (0, 0, 0, 0))
target_h = 180
target_w = int(round(shield.width * (target_h / shield.height)))
scaled_192 = shield.resize((target_w, target_h), Image.Resampling.LANCZOS)
fav192.paste(scaled_192, ((192 - target_w) // 2, (192 - target_h) // 2), scaled_192)
fav192.save(r'c:\Users\Admin\Desktop\OnaPolisi\favicon-192.png')
print("Saved favicon-192.png")

# 512x512 favicon (PWA splash / high-res)
fav512 = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
target_h = 480
target_w = int(round(shield.width * (target_h / shield.height)))
scaled_512 = shield.resize((target_w, target_h), Image.Resampling.LANCZOS)
fav512.paste(scaled_512, ((512 - target_w) // 2, (512 - target_h) // 2), scaled_512)
fav512.save(r'c:\Users\Admin\Desktop\OnaPolisi\favicon-512.png')
print("Saved favicon-512.png")

# Multi-res favicon.ico (16, 32, 48)
fav48 = fav192.resize((48, 48), Image.Resampling.LANCZOS)
fav16.save(r'c:\Users\Admin\Desktop\OnaPolisi\favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)], append_images=[fav32, fav48])
print("Saved favicon.ico")

# Standalone logo-icon.png (256x256)
logo_icon = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
target_h = 240
target_w = int(round(shield.width * (target_h / shield.height)))
scaled_icon = shield.resize((target_w, target_h), Image.Resampling.LANCZOS)
logo_icon.paste(scaled_icon, ((256 - target_w) // 2, (256 - target_h) // 2), scaled_icon)
logo_icon.save(r'c:\Users\Admin\Desktop\OnaPolisi\logo-icon.png')
print("Saved logo-icon.png")
