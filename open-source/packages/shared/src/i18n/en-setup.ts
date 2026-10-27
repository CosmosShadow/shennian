// @arch open-source/docs/shared-runtime.md
export const enSetup = {
  setup_show_full_prompt: 'View full prompt',
  setup_room_link: 'This is a room link',
  setup_room_link_hint:
    'This link joins a room; it does not connect or share a machine. Open the room confirmation page?',
  setup_authorization_code:
    'This is a sign-in or browser authorization code. Use the scanner above to review its authorization before continuing.',
  spaces_enter_link: 'Enter room link',
  spaces_invitation_text: 'You’re invited to join the Shennian conversation “{{name}}”.',
  spaces_group_text: 'Open the Shennian conversation “{{name}}”.',
  spaces_invite_ai_instruction:
    'Open the link, or send this message to your AI so it can install Shennian, guide pairing, and join the conversation.',
  spaces_group_ai_instruction:
    'Existing members can open the link or send this message to their AI to open the conversation.',
  spaces_invite_url_label: 'Invite',
  spaces_group_url_label: 'Conversation',
  spaces_install_url_label: 'Install',

  setup_own_computer: 'Connect your computer',
  setup_own_computer_hint: 'Choose one setup method on the computer where you want AI to run.',
  setup_install_with_ai: 'Ask AI to set it up',
  setup_copy_prompt_to_computer_ai: 'Send this complete prompt to an AI on the target computer',
  setup_step_install: 'Install Client',
  setup_platform_support: 'Supports macOS, Windows and Linux',
  setup_client_install_prompt:
    'Read {{url}}, install or update Shennian on this computer, guide me through account confirmation and machine pairing, connect the available AI tools, and ask which other AI tools I want to connect.',
  setup_selfhost_client_install_prompt:
    'Install or update Shennian Client on this computer and connect only to the self-hosted server {{server}}. Use a separate HOME and workspace; do not inherit official-cloud accounts, history or secrets. Run shennian pair --server {{server}} --token, enter its pairing code in this mobile instance, then connect the available local AI tools. Do not use default official-cloud pairing or disable TLS verification. For a private CA, trust it as instructed by the administrator first.',
  setup_copy_install_prompt: 'Copy installation prompt',
  setup_manual_install_client: 'Install Client manually',
  setup_step_connect: 'Connect the machine',
  setup_step_connect_hint:
    'When your computer shows a pairing code or QR code, scan it or enter the code. You can also paste a machine-sharing link.',
  setup_install_prompt_footer: 'Send this to an AI on your computer. Supports macOS, Windows and Linux.',
  setup_pair_code_placeholder: 'Pairing code or sharing link',
  setup_connect: 'Connect',
  setup_scan_summary: 'Pairing QR code or machine-sharing QR code',
  setup_install_with_ai_hint:
    'Send the text below to an AI on the target computer. It will inspect the current setup, install Shennian CLI and Skill, and guide machine pairing.',
  setup_manual_install_link: 'Manual setup',
  setup_manual_install_link_hint: 'View the complete installation, pairing, and AI setup on the website',
  setup_view_full_install_guide: 'View full guide',
  setup_desktop_recommended: 'Desktop · Recommended',
  setup_desktop_summary: 'Mac / Windows. View download and setup instructions',
  setup_server: 'Server / command-line setup',
  setup_server_summary: 'View installation and sign-in steps',
  setup_already_installed: 'Already installed',
  setup_pair: 'Connect with a pairing code',
  setup_pair_summary: 'Use when your computer shows a pairing code or QR code',
  setup_invite: 'Received a machine invitation',
  setup_invite_summary:
    'Accept access to someone else’s machine. You do not need Client on your own computer. This permission is separate from joining a room.',
  setup_invite_short: 'Paste the machine-sharing link someone sent you',
  setup_desktop_title: 'Install Shennian on your computer',
  setup_desktop_instructions:
    'Open the download address on the Mac / Windows computer where AI will run and choose its installer. You do not need to download the computer installer onto your phone.',
  setup_copy_computer_address: 'Copy computer download address',
  setup_desktop_sign_in:
    'Install and open Shennian, then sign into the same account as your phone. Desktop includes the machine connection component; no separate Shennian Client is needed. Your computer is normally linked after sign-in.',
  setup_desktop_trouble:
    'Machine missing? Check the account, network and whether Shennian is running. If you paused the machine, resume it on that computer; reinstalling is unnecessary.',
  setup_server_intro:
    'For servers, SSH environments, or computers without Shennian Desktop. Perform all steps on the target machine. If Desktop is installed, reuse its bundled command.',
  setup_manual_install: '1. Install it yourself',
  setup_terminal_hint:
    'Open Terminal on Mac / Linux or PowerShell on Windows. Follow the guide to prepare Node.js 18 or later, then run these commands. If using WSL, install in the environment where your AI runs.',
  setup_environment_guide: 'View complete setup and requirements',
  setup_ai_install: 'Or ask an AI you already use',
  setup_ai_prompt: 'Go to {{url}} and install the Shennian Client for me.',
  setup_sign_in_choices: '2. Sign in for your environment',
  setup_browser_login:
    'Browser available: open the sign-in page shown in the terminal, sign into the same Shennian account and confirm. Return to the terminal and check that the service started. A pairing code may not be needed.',
  setup_code_login:
    'On a server or without a browser: choose pairing in the setup guide and enter the displayed code on your phone, or scan the terminal QR code. Both sign-in methods also apply when an AI helps you install.',
  setup_have_code: 'My computer shows a code — connect',
  setup_pair_instructions:
    'Use this when the target computer displays a Shennian pairing code or QR code. Desktop normally links after signing into the same account without another scan.',
  setup_scan_invite: 'Scan machine invitation QR',
  setup_pair_input: 'Enter the pairing code from your computer',
  setup_invite_input: 'Paste the machine invitation link',
  setup_invite_invalid: 'This is not a valid machine invitation. Ask the owner for the full link.',
  setup_preview_invite: 'Review and confirm invitation',
  setup_check_connection: 'Installed — check connection',
  setup_confirm_machine:
    'Confirm your target machine below, then check its AI. An online machine and usable AI are separate checks.',
  setup_view_ai: 'View AI',
  setup_no_machine:
    'No machine found yet. Check the account, connection and that Shennian is running, then check again.',
  setup_return_project: 'Return to creating a project',
  setup_refresh_failed: 'Could not read machines. Tap to retry.',
  setup_claim_refresh_failed:
    'Pairing was confirmed, but the machine list has not synced. Check the connection again; do not resubmit the code.',
  setup_claim_success: 'Pairing confirmed. Check whether the target machine is online.',
  setup_copy_failed: 'Copy failed. Select the text above to copy it manually.',
  setup_open_failed: 'Could not open the link. Copy the address into your browser.',
  setup_preview: 'Preview',
  setup_download_not_published: 'No installer has been published yet',
  setup_download_failed: 'Version information is unavailable',
  download_return_invite:
    'Return to the original invitation after installation. To participate in this room, you can stay on this web page.',
  download_official_site: 'Website and all setup options',
} as const
