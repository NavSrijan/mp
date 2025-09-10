import asyncio
import json
import time
import websockets

INFRA_WS = 'ws://localhost:8000/infra-ws'

async def monitor():
    print('Connecting to', INFRA_WS)
    async for ws in websockets.connect(INFRA_WS, ping_interval=20, ping_timeout=20):
        try:
            async for msg in ws:
                data = json.loads(msg)
                ts = time.strftime('%H:%M:%S')
                gateways = data.get('gateways', [])
                towers = data.get('mobile_towers', [])
                tolls = data.get('toll_gates', [])
                print(f"[{ts}] agents={data.get('agent_count')} gateways={len(gateways)} towers={len(towers)} tolls={len(tolls)}")
                if gateways:
                    print('  Gateways:')
                    for g in gateways:
                        print(f"    {g.get('name','GW')} near={g.get('nearby_agents')} lon={g['lon']:.5f} lat={g['lat']:.5f}")
                if towers:
                    print('  Towers:')
                    for t in towers:
                        print(f"    {t.get('name','TWR')} near={t.get('nearby_agents')} r={t.get('radius')} lon={t['lon']:.5f} lat={t['lat']:.5f}")
                if tolls:
                    print('  Tolls:')
                    for tg in tolls:
                        print(f"    {tg.get('name','TOLL')} near={tg.get('nearby_agents')} fee={tg.get('fee')} lon={tg['lon']:.5f} lat={tg['lat']:.5f}")
        except Exception as e:
            print('Connection error, retrying in 2s:', e)
            await asyncio.sleep(2)

if __name__ == '__main__':
    try:
        asyncio.run(monitor())
    except KeyboardInterrupt:
        print('Stopped.')
