#!/bin/bash

set -eu

sed -i '/brew "jandedobbeleer\/oh-my-posh\/oh-my-posh"/d' /root/.config/yadm/Brewfile
