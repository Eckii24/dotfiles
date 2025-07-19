# Install applications using winget
Write-Host "Install main applications"
winget install -e --id Microsoft.PowerToys
winget install -e --id Microsoft.PowerShell
winget install -e --id Microsoft.AzureCLI
winget install -e --id Docker.DockerDesktop
winget install -e --id JetBrains.Toolbox
winget install -e --id Microsoft.VisualStudioCode
winget install -e --id Postman.Postman
winget install -e --id=Freelensapp.Freelens
winget install -e --id=Camunda.Modeler
winget install --accept-package-agreements mockoon

# Setup WSL
Write-Host "Setup WSL"
wsl --install -d Debian
Write-Warning "Setup certificates inside WSL"
Write-Warning "1. Get the ZScaler root certificate from IT4U, search for 'Adding Zscaler Root Certificate to Application Specific Trust Store'"
Write-Warning "2. Save certificate here: '/usr/local/share/ca-certificates/zscaler-root-cert.crt"
Write-Warning "3. Update ca-certificates: 'sudo update-ca-certificates'"
Write-Warning "4. Make sure correct curl version is used: 'mv /home/linuxbrew/.linuxbrew/bin/curl /home/linuxbrew/.linuxbrew/bin/curl_bak"
Write-Warning "5. ENV variables are set automatically in WSL environment"
Write-Warning "6. Copy secret files from 1Password into WSL: 200.secrets.zsh, secrets.json, Nuget.Config.xml, .ssh"

# Install and configure terminals
Write-Host "Setup terminals"
winget install -e --id Microsoft.WindowsTerminal

Invoke-WebRequest -Uri "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/Hack.zip" -OutFile "$HOME/Downloads/Hack.zip"
Expand-Archive -Path "$HOME/Downloads/Hack.zip" -DestinationPath "$HOME/Downloads/Hack"
Write-Warning "Please install the Hack font manually from $HOME/Downloads/Hack/"

Write-Warning "Install the Font and the Color Scheme in WindowsTerminal manually"

# Install Azure VPN
Write-Host "Setup Azure VPN"
winget install -e --id "9NP355QT2SQB" #Azure VPN Client
Write-Warning "Please import the Azure VPN settings according to the docs."
