import os
import base64
from PIL import Image, ImageDraw, ImageFont

# Path to the source shield cutout
shield_path = r'c:\Users\Admin\Desktop\OnaPolisi\shield-cutout-aa.png'
shield = Image.open(shield_path).convert('RGBA')

with open(shield_path, 'rb') as f:
    shield_b64 = base64.b64encode(f.read()).decode('utf-8')

# Shield aspect ratio: 635 x 1024 = 0.6201
# In 60px viewBox height, a height of 56px gives width of 56 * 0.6201 = 34.7px.
# 1. Generate enlarged logo.svg (viewBox 0 0 236 60, height 60)
logo_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 236 60" width="236" height="60" fill="none">
  <image href="data:image/png;base64,{shield_b64}" x="2" y="2" width="38" height="56" preserveAspectRatio="xMidYMid meet" />
  <text x="48" y="39" font-family="Plus Jakarta Sans, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="25" font-weight="800" fill="#0F1419" letter-spacing="-0.03em">Ona Polisi</text>
</svg>"""

with open(r'c:\Users\Admin\Desktop\OnaPolisi\logo.svg', 'w', encoding='utf-8') as f:
    f.write(logo_svg)
print("Saved larger logo.svg")

# 2. Generate enlarged logo-white.svg
logo_white_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 236 60" width="236" height="60" fill="none">
  <image href="data:image/png;base64,{shield_b64}" x="2" y="2" width="38" height="56" preserveAspectRatio="xMidYMid meet" />
  <text x="48" y="39" font-family="Plus Jakarta Sans, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="25" font-weight="800" fill="#FFFFFF" letter-spacing="-0.03em">Ona Polisi</text>
</svg>"""

with open(r'c:\Users\Admin\Desktop\OnaPolisi\logo-white.svg', 'w', encoding='utf-8') as f:
    f.write(logo_white_svg)
print("Saved larger logo-white.svg")

# 3. Generate enlarged logo-icon.svg
logo_icon_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="60" height="60" fill="none">
  <image href="data:image/png;base64,{shield_b64}" x="5" y="2" width="50" height="56" preserveAspectRatio="xMidYMid meet" />
</svg>"""

with open(r'c:\Users\Admin\Desktop\OnaPolisi\logo-icon.svg', 'w', encoding='utf-8') as f:
    f.write(logo_icon_svg)
print("Saved larger logo-icon.svg")

# 4. Generate high-res logo.png (super-sampled 4x)
scale = 4
lw, lh = 236 * scale, 60 * scale
logo_img = Image.new('RGBA', (lw, lh), (0, 0, 0, 0))
target_sh_h = int(56 * scale)
target_sh_w = int(round(shield.width * (target_sh_h / shield.height)))
scaled_sh = shield.resize((target_sh_w, target_sh_h), Image.Resampling.LANCZOS)
logo_img.paste(scaled_sh, (int(4 * scale), int(2 * scale)), scaled_sh)

draw = ImageDraw.Draw(logo_img)
font = None
font_names = ["segoeuib.ttf", "arialbd.ttf", "calibrib.ttf", "arial.ttf"]
for fn in font_names:
    try:
        font = ImageFont.truetype(fn, int(25 * scale))
        break
    except Exception:
        continue
if font is None:
    font = ImageFont.load_default()

draw.text((int(48 * scale), int(15 * scale)), "Ona Polisi", font=font, fill=(15, 20, 25, 255))
logo_final = logo_img.resize((472, 120), Image.Resampling.LANCZOS)
logo_final.save(r'c:\Users\Admin\Desktop\OnaPolisi\logo.png')
print("Saved larger logo.png")

# 5. Generate high-res logo-white.png
logo_white_img = Image.new('RGBA', (lw, lh), (0, 0, 0, 0))
logo_white_img.paste(scaled_sh, (int(4 * scale), int(2 * scale)), scaled_sh)
draw_w = ImageDraw.Draw(logo_white_img)
draw_w.text((int(48 * scale), int(15 * scale)), "Ona Polisi", font=font, fill=(255, 255, 255, 255))
logo_white_final = logo_white_img.resize((472, 120), Image.Resampling.LANCZOS)
logo_white_final.save(r'c:\Users\Admin\Desktop\OnaPolisi\logo-white.png')
print("Saved larger logo-white.png")
