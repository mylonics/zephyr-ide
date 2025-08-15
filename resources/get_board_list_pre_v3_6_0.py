# Copyright (c) 2019 Nordic Semiconductor ASA
#
# SPDX-License-Identifier: Apache-2.0

import argparse
import os
from pathlib import Path
import re
import sys

import argparse

from west import log

ZEPHYR_BASE = Path(os.environ.get('ZEPHYR_BASE'))

sys.path.append(os.fspath(ZEPHYR_BASE.joinpath("scripts")))

import list_boards

def get_boards(args):
    if args.name_re is not None:
        name_re = re.compile(args.name_re)
    else:
        name_re = None
    args.arch_roots = [ZEPHYR_BASE]
    args.soc_roots = [ZEPHYR_BASE]
    for board in list_boards.find_boards(args):
        if name_re is not None and not name_re.search(board.name):
            continue
        log.inf(args.format.format(name=board.name, arch=board.arch,
                                   dir=board.dir))

parser = argparse.ArgumentParser()      

parser.add_argument('-f', '--format', default='{name}',
                    help='''Format string to use to list each board;
                            see FORMAT STRINGS below.''')
parser.add_argument('-n', '--name', dest='name_re',
                    help='''a regular expression; only boards whose
                    names match NAME_RE will be listed''')

list_boards.add_args(parser)
args = parser.parse_args()
get_boards(args)
