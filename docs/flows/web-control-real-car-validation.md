# Web Control Real-Car Validation

Status: not run. Unit and fake-TCP tests do not prove vehicle behavior.

Before testing, ensure the vehicle has a clear stopping area and an operator
can immediately stop power or motion. Validate the connection, each button
direction and Stop/Brake, rocker release, explicit Disconnect, reconnect to a
new target, gateway exit, wheel reset, media commands, tracking toggle, and
direct video URL. Record the target IP, observed packet behavior, browser
video result, any TCP response, and whether the vehicle stopped after each
disconnect path. A loaded iframe is not proof that the video stream is healthy.
