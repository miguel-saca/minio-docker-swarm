name: Bug report
description: Report a problem with the guide or assets
title: "[bug] "
labels: [bug]
body:
  - type: textarea
    attributes:
      label: What happened?
      description: Describe the bug and how to reproduce it
    validations:
      required: true
  - type: input
    attributes:
      label: Environment
      description: OS/Distribution, Docker version, Swarm version
  - type: textarea
    attributes:
      label: Logs / screenshots
