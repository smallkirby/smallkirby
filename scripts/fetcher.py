import youtube_dl
import os

ydl_opts = {'ignoreerrors': True, 'quiet': True}
count = 0
badge_str = "![nirugiri](https://img.shields.io/static/v1?label=nirugiri&message={}&color=orange)\n"

with youtube_dl.YoutubeDL(ydl_opts) as ydl:
    playlist_dict = ydl.extract_info("https://youtu.be/yvUvamhYPHw", download=False)
    count = playlist_dict["view_count"]

badge_str = badge_str.format(count)
print(badge_str)
if os.path.exists("README.md"):
    os.remove("README.md")
with open("README.md", "w+") as f:
    f.write(badge_str)