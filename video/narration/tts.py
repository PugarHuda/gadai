# Edge neural TTS per scene -> ../public/voice/<id>.mp3 + words (ms) in ../public/voice/words.json
import asyncio, json, edge_tts, subprocess
VOICE = "en-US-AndrewMultilingualNeural"
async def one(s):
    c = edge_tts.Communicate(s["text"], VOICE, rate="+3%", boundary="WordBoundary")
    audio, words = bytearray(), []
    async for ch in c.stream():
        if ch["type"] == "audio": audio += ch["data"]
        elif ch["type"] == "WordBoundary": words.append({"w": ch["text"], "s": ch["offset"] / 1e4, "e": (ch["offset"] + ch["duration"]) / 1e4})
    open(f"../public/voice/{s['id']}.mp3", "wb").write(audio)
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f"../public/voice/{s['id']}.mp3"]))
    return {"id": s["id"], "dur": dur, "words": words}
async def main():
    out = [await one(s) for s in json.load(open("script.json"))]
    json.dump(out, open("../public/voice/words.json", "w"), indent=0)
    for o in out: print(o["id"], round(o["dur"], 2), len(o["words"]))
    print("total", round(sum(o["dur"] for o in out), 1))
asyncio.run(main())
