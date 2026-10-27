// @arch open-source/docs/shared-runtime.md
export const enAgentSetup = {
  desktop_client_missing_title: 'Install the independent Shennian Client',
  desktop_client_missing_body:
    'Desktop can still use your account, rooms and remote machines. Install and pair Client separately for this user before running AI on this computer. Desktop does not install Client, Node.js or third-party AI tools.',
  desktop_client_copy_for_ai: 'Copy requirements for AI',
  desktop_client_manual_install: 'View manual setup',
  desktop_client_recheck: 'Check again',
  desktop_client_action_failed:
    'The action did not complete. Retry or open https://shennian.net/install.md directly.',
  desktop_client_install_prompt:
    'Open and follow https://shennian.net/install.md to install or reuse Shennian CLI and the official Shennian Skill for the current user on this computer. First run shennian --version and shennian status --json, and do not duplicate a working installation. If Node.js, npm, permissions, PATH, network access, or pairing is missing, explain the exact issue and follow the official steps. Get my confirmation before installation, sign-in, pairing, or resuming an intentional pause. Do not install or sign in to third-party AI tools and do not modify project files. Finish by verifying that Shennian CLI is paired and running and that a fresh conversation discovers the Skill, then tell me the machine is ready to use in Shennian.',
  machine_agents_current_summary: 'AI Tools on {{name}}',
  machine_agents_more_title: 'Connect more AI tools',
  machine_agents_missing_hint:
    'Enter the tool you want, then send the generated sentence to an AI on your computer.',
  machine_agents_tool_label: 'AI tool to connect',
  machine_agents_tool_placeholder: 'For example, Qwen Code',
  machine_agents_copy_help: 'Copy prompt',
  machine_agents_help_prompt:
    'Please use the official Shennian Skill ({{skillUrl}}) to connect “{{agent}}” to Shennian. If installation or pairing is needed, follow {{installUrl}}.',
  agents_validation_quota_exceeded:
    'The provider’s credits, subscription or rate limit blocked this test. Check that account before retrying.',
  agents_validation_network_failed:
    'The target computer could not connect to the AI service. Check its network and retry.',
  ai_setup_entry_hint:
    'Choose an AI for installation, sign-in and checking steps. Working tools do not need reinstalling.',
  ai_setup_entry: 'AI installation and sign-in help',
  ai_setup_checking: 'Checking…',
  ai_setup_state_offline: 'Connect the target computer first',
  ai_setup_state_owner: 'Ask the machine owner to prepare this AI',
  ai_setup_state_missing: 'Prepare a callable AI tool',
  ai_setup_state_version: 'Check the tool version',
  ai_setup_state_configuration: 'Check sign-in or configuration',
  ai_setup_state_login: 'Sign into this AI provider',
  ai_setup_state_unknown: 'Tool found — sign-in not confirmed',
  ai_setup_state_authenticated: 'Sign-in detected',
  ai_setup_help_offline:
    'AI cannot be checked while the computer is off, offline or paused. Check Shennian on the target computer; refreshing will not resume an intentional pause.',
  ai_setup_help_owner:
    'You can use the capabilities granted to you, but cannot install or configure AI for the owner. Ask the owner to prepare it on this computer.',
  ai_setup_help_missing:
    'A desktop chat app may not include a tool Shennian can call. Check existing installations, then follow the official steps to prepare what is missing. You do not need to reinstall Shennian.',
  ai_setup_help_version:
    'The selected tool and desktop app report different versions. Review the runtime source and provider update instructions, then check again. Shennian does not automatically upgrade tools or close your tasks.',
  ai_setup_help_configuration:
    'Review the account, network and configuration using the official guide. Keep your existing API or enterprise settings; a failure does not necessarily mean the tool is missing.',
  ai_setup_help_login:
    'The tool was found. Sign into the provider on the target computer, then return here to check again. Shennian sign-in does not replace provider sign-in.',
  ai_setup_help_unknown:
    'This tool or older Shennian version did not report a confirmed sign-in state. Do not reinstall by default. Send a hello test below, or check sign-in on the target computer.',
  ai_setup_help_authenticated:
    'Sign-in credentials were detected without sending a model request. Test the selected model below. A successful test verifies this connection; real tasks remain subject to quota and permissions.',
  ai_setup_target: 'Work on “{{name}}” · {{os}}',
  ai_setup_tool_version: 'Selected tool version: {{version}}',
  ai_setup_step_install: '1. Check the tool',
  ai_setup_windows:
    'Windows: if you only have the Codex desktop app, prepare its standalone command-line tool. Follow the Windows requirements for your Claude Code version. With an existing WSL setup, install and sign in in the same environment as your working directory.',
  ai_setup_codex_windows:
    'Codex on Windows: Shennian only uses a Windows Codex command-line tool that runs directly on this computer. It does not switch to a Codex inside WSL when none is found. Shennian recognises the command-line copy the Codex desktop app keeps in your user folder; the program inside the Store package cannot be launched by other programs. If none is found, open the Codex desktop app once, or install the standalone command-line version and add it to your user PATH, or set the SHENNIAN_CODEX_PATH environment variable to its full path. After changing this, restart the Shennian Client and use Check again below. Pending messages are kept and retried automatically once it is available.',
  ai_setup_codex_wsl:
    'If Codex is installed inside WSL: install and pair another Shennian Client inside WSL. It appears in your account as a separate computer, so start new sessions there; existing Windows sessions and messages do not move to it.',
  ai_setup_unix:
    'On Mac, Shennian tries usable tools bundled with Codex / Claude Desktop first. If none is found, follow the official command-line setup. Use Terminal on Mac / Linux. After installation, open a new terminal and confirm the command shows its version.',
  ai_setup_official_install: 'View {{agent}} setup steps',
  ai_setup_step_login: '2. Sign in on the target computer',
  ai_setup_login_hint:
    'Open a terminal on the target computer and complete the official {{agent}} sign-in. Confirm browser authorization yourself. If an older version does not support the command below, follow its official sign-in guide.',
  ai_setup_official_login: 'View official sign-in and account guide',
  ai_setup_account_limits:
    'Provider subscriptions, API credits and enterprise configuration belong to that account. Do not post passwords, codes or keys in a Shennian room. If sign-in is cancelled or expires, retry through the provider.',
  ai_setup_optional_ai: 'Optional: ask your existing AI',
  ai_setup_optional_hint:
    'This needs an AI that can already run commands on the target computer. Without one, follow the official steps above; Skill is not required.',
  ai_setup_copy_prompt: 'Copy for my existing AI',
  ai_setup_prompt:
    'Help prepare {{agent}} on “{{machine}}” ({{os}}) for Shennian. Confirm you can execute commands on that computer, check the existing Shennian installation and status, then run shennian agent discover. Reuse working tools. Follow {{install}} for missing setup and {{login}} to guide my own sign-in; never request passwords, codes or keys or switch accounts. Discover again, use the returned type {{type}} and model, and confirm my project directory. Run shennian agent check {{type}} --workdir "absolute project path" once to send a real availability test using my model quota. Only ready=true confirms success. Explain failures and the next step without repeatedly sending tests. If these commands are unsupported, update the existing installation or ask me to test in Shennian; do not install a second Client. Remind me to refresh Shennian and continue my original task. Do not require Skill, create a room or managed Agent, stop tasks or resume an intentional pause.',
  ai_setup_check_again: 'I’m done, check again',
  ai_setup_first_task:
    '“Check again” only refreshes discovery and sign-in. Use the explicit hello test below to verify a model reply, then return to your original task.',
  ai_setup_test_title: '3. Test a reply',
  ai_setup_test_hint:
    'Choose a project directory on this computer and a model, then send one hello test using that AI’s model quota. It creates no managed Agent or room and sends no room messages.',
  ai_setup_test_action: 'Send hello test',
  ai_setup_test_running: 'Waiting for the test reply…',
  ai_setup_test_passed:
    'Test passed: the selected AI and model returned hello. Return to your original task to continue.',
  ai_setup_test_failed_hint:
    'Follow the reason above to check installation, sign-in, directory, model access or network, then retry. Your selections are preserved.',
  ai_setup_continue: 'Back — continue where I left off',
  ai_setup_check_failed:
    'The check did not complete. Confirm the machine is online and retry. If installation just finished, check the runtime environment on the target computer.',
} as const
