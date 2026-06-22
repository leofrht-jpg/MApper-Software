# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Shared WebSocket progress streaming for any task."""
import asyncio
import json

from fastapi import WebSocket, WebSocketDisconnect

from mapper.api import tasks as task_registry
from mapper.core.tasks import get_task


async def stream_task_progress(websocket: WebSocket, task_id: str) -> None:
    """Stream a task's progress events to a WebSocket client."""
    await websocket.accept()

    task = get_task(task_id)
    if task is None:
        await websocket.send_json({"step": "error", "progress": 0, "message": "Task not found"})
        await websocket.close()
        return

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue[dict] = asyncio.Queue()

    def on_update(payload: dict) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, payload)

    task.subscribe(on_update)

    # Send current state immediately (task may already be running)
    await websocket.send_json(task.current_payload())

    try:
        while True:
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=30.0)
                await websocket.send_json(payload)
                if payload.get("step") in ("done", "error", "cancelled"):
                    break
            except asyncio.TimeoutError:
                # Send heartbeat
                await websocket.send_json({"step": task.step, "progress": task.progress, "message": task.message})
                if task.status in ("done", "error", "cancelled"):
                    break
    except WebSocketDisconnect:
        pass
    finally:
        task.unsubscribe(on_update)
        # Disconnect-cancel for tasks that registered with the cancellation
        # registry (legacy single-year LCA does; ecoinvent imports do not —
        # the registry's maybe_cancel returns False for unregistered ids).
        task_registry.maybe_cancel_on_last_subscriber_leave(
            task_id,
            remaining_subscribers=len(task.subscribers),
            task_done=task.status in ("done", "error", "cancelled"),
        )
        try:
            await websocket.close()
        except Exception:
            pass
