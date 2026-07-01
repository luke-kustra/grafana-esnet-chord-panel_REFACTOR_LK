# Chord Panel Plugin



This is a panel plugin for generating Chord diagrams in Grafana 8.3+. This plugin uses a locally included version of [d3](https://github.com/d3/d3).

![Screenshot](https://github.com/esnet/grafana-esnet-chord-panel/blob/main/src/img/Chord-Example.png?raw=true)

## Data
This plugin uses non time series data and requires each row to have 2 data fields and a metric or value field.

**NOTE**: If the panel is blank even though your data input is correct, it may be too small.  Try resizing the panel until it is large enough to display the chord diagram.

## Customizing
### Display
Source Field: The query field to use as the source of the chord.

Target Field: The query field to use as the target of the chord.

Value Field: The query field (usually the metric) to be used to determine the thickness of the each chord.

Text Length: The amount of space alloted for labels on the outside of the diagram.

### Standard
Units: Set the units for the values in the Standard Options section.



*** Copyright Notice ***

Grafana Plugin: Chord Diagram (esnet-chord-diagram) Copyright (c) 2022,
The Regents of the University of California, through Lawrence Berkeley
National Laboratory (subject to receipt of any required approvals from the
U.S. Dept. of Energy). All rights reserved.

If you have questions about your rights to use or distribute this software,
please contact Berkeley Lab's Intellectual Property Office at
IPO@lbl.gov.

NOTICE.  This Software was developed under funding from the U.S. Department
of Energy and the U.S. Government consequently retains certain rights.  As
such, the U.S. Government has been granted for itself and others acting on
its behalf a paid-up, nonexclusive, irrevocable, worldwide license in the
Software to reproduce, distribute copies to the public, prepare derivative 
works, and perform publicly and display publicly, and to permit others to do so.
