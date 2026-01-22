defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad TrackpadRightClick -bool true
defaults write com.apple.AppleMultitouchTrackpad TrackpadRightClick -bool true

defaults write NSGlobalDomain AppleLanguages -array "en-DE" "de-DE"

defaults write com.apple.dock show-recents -bool false

defaults write com.apple.dock wvous-bl-corner -int 10
defaults write com.apple.dock wvous-bl-modifier -int 0

killall Dock
