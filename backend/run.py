import uvicorn
from app.core.config import settings

if __name__ == "__main__":
    if settings.NGROK_AUTHTOKEN:
        try:
            from pyngrok import ngrok
            ngrok.set_auth_token(settings.NGROK_AUTHTOKEN)
            
            connect_kwargs = {}
            if settings.NGROK_DOMAIN:
                connect_kwargs["domain"] = settings.NGROK_DOMAIN
                
            public_url = ngrok.connect(settings.APP_PORT, **connect_kwargs)
            print("\n" + "=" * 80)
            print(f"  [ngrok] Tunnel established successfully!")
            print(f"  [ngrok] Public URL: {public_url}")
            print("=" * 80 + "\n")
        except Exception as e:
            print(f"\n  [ngrok] Failed to start tunnel: {e}\n")

    uvicorn.run(
        "app.main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=False,
    )
