"""Private JSON-lines bridge to Nous Research's supported AIAgent Python library.
Only gateway tools are registered. No public Hermes API is invented here.
"""
import contextlib
import json
import sys

WIRE = sys.stdout

def emit(value):
    WIRE.write(json.dumps(value) + '\n')
    WIRE.flush()

def main():
    request = json.loads(sys.stdin.readline())
    with contextlib.redirect_stdout(sys.stderr):
        # This is an application-owned, per-user Hermes home. Keep all other
        # provider/auth settings intact while exposing only explicit gateway tools.
        from hermes_cli.config import load_config, save_config
        config = load_config()
        config.setdefault('tools', {})['tool_search'] = {'enabled': 'off'}
        save_config(config)
        from run_agent import AIAgent
        from tools.registry import registry
        for definition in request['tools']:
            def handler(args, _name=definition['name'], **kwargs):
                emit({'type': 'tool', 'name': _name, 'args': args})
                reply = sys.stdin.readline()
                if not reply:
                    raise RuntimeError('Gateway disconnected')
                return reply.strip()
            registry.register(name=definition['name'], toolset='visionclaw', schema=definition, handler=handler)
        agent = AIAgent(
            provider=request.get('provider') or None, model=request.get('model') or '',
            base_url=request.get('baseUrl') or None, api_key=request.get('apiKey') or None,
            enabled_toolsets=['visionclaw'], quiet_mode=True, verbose_logging=False,
            # Background memory/skill review is not a constructor flag in the
            # official runtime. It only spawns when "memory" or "skill_manage"
            # is in agent.valid_tool_names, so skip_memory plus the single
            # gateway toolset below already keep it from ever running.
            skip_memory=True, skip_context_files=True,
            save_trajectories=False, max_iterations=40,
            ephemeral_system_prompt=request['instructions'], session_id=request['sessionId'],
        )
        if set(agent.valid_tool_names) - {t['name'] for t in request['tools']}:
            raise RuntimeError('Unexpected tool enabled')
        content = request['task']
        if request.get('images'):
            content = [{'type': 'text', 'text': content}] + [
                {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + image}}
                for image in request['images']
            ]
        result = agent.run_conversation(user_message=content, task_id=request['runId'],
                                        conversation_history=request.get('history') or None)
    emit({'type': 'result', 'result': result.get('final_response', '')})

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'type': 'error', 'code': type(error).__name__, 'message': 'Hermes could not complete this task. Check runtime and provider authentication.'})
        sys.exit(1)
