local wezterm = require "wezterm"
local config = wezterm.config_builder()

if wezterm.target_triple:find("darwin") ~= nil then
  config.window_decorations = "RESIZE"
end

if wezterm.target_triple:find("windows") ~= nil then
  config.default_domain = "WSL:Debian"
  config.prefer_egl = true
end

config.color_scheme = "tokyonight_moon"
config.font = wezterm.font "Hack Nerd Font"

config.hide_tab_bar_if_only_one_tab = true
config.window_close_confirmation = "NeverPrompt"

config.leader = { key = "w", mods = "ALT", timeout_milliseconds = 2000 }
config.keys = {
  { mods = "LEADER", key = "t", action = wezterm.action.SpawnTab "CurrentPaneDomain" },
  { mods = "LEADER", key = "c", action = wezterm.action.CloseCurrentPane { confirm = true } },
  { mods = "LEADER|SHIFT", key = "h", action = wezterm.action.ActivateTabRelative(-1) },
  { mods = "LEADER|SHIFT", key = "l", action = wezterm.action.ActivateTabRelative(1) },
  { mods = "LEADER", key = "v", action = wezterm.action.SplitHorizontal { domain = "CurrentPaneDomain" } },
  { mods = "LEADER", key = "s", action = wezterm.action.SplitVertical { domain = "CurrentPaneDomain" } },
  { mods = "LEADER", key = "h", action = wezterm.action.ActivatePaneDirection "Left" },
  { mods = "LEADER", key = "j", action = wezterm.action.ActivatePaneDirection "Down" },
  { mods = "LEADER", key = "k", action = wezterm.action.ActivatePaneDirection "Up" },
  { mods = "LEADER", key = "l", action = wezterm.action.ActivatePaneDirection "Right" },
  { mods = "LEADER", key = "LeftArrow", action = wezterm.action.AdjustPaneSize { "Left", 5 } },
  { mods = "LEADER", key = "RightArrow", action = wezterm.action.AdjustPaneSize { "Right", 5 } },
  { mods = "LEADER", key = "DownArrow", action = wezterm.action.AdjustPaneSize { "Down", 5 } },
  { mods = "LEADER", key = "UpArrow", action = wezterm.action.AdjustPaneSize { "Up", 5 } },
}

for i = 0, 8 do
  -- leader + number to activate that tab
  table.insert(config.keys, { key = tostring(i+1), mods = "LEADER", action = wezterm.action.ActivateTab(i) })
end

return config
