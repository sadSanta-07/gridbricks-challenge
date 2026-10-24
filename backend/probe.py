
from fastapi import FastAPI
from workers import asgi

app = FastAPI()

@app.get("/")
async def root():
    return {"status": "ok"}

Default = asgi.entrypoint(app)
