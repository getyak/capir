# SPDX-License-Identifier: Apache-2.0
# The reviewed shaded JAR is the only filesystem payload replaced here.
FROM ghcr.io/comet-ml/opik/opik-backend@sha256:2ea3198d94b010404cd7108d41471382aa6e280485f2e1aad038093bb0fafa83

COPY --chown=1001:1001 --chmod=0644 opik-backend-2.2.45.jar /opt/opik/opik-backend-2.2.45.jar

LABEL io.capir.opik.input-lock.schema="capri.opik.runtime-image-input-lock.v1" \
      io.capir.opik.upstream.revision="dd40343a223ec8d0ab11eafc5f88cbf18532c0ac" \
      io.capir.opik.base.reference="ghcr.io/comet-ml/opik/opik-backend@sha256:2ea3198d94b010404cd7108d41471382aa6e280485f2e1aad038093bb0fafa83" \
      io.capir.opik.base.platform="linux/arm64" \
      io.capir.opik.package.artifact-id="12997662015" \
      io.capir.opik.package.run-id="41099210888" \
      io.capir.opik.package.run-attempt="1" \
      io.capir.opik.package.checkout="4bf3a18e0bd8928ac3f61a1c9084b56488c8b70c" \
      io.capir.opik.package.workflow-head="8942eb8d3f93927cd1bf0d8e42e73fdb4241f4f6" \
      io.capir.opik.package.zip.sha256="2a63aae7c3d9a8c06dc2d08236788423f772f9e2e5b0e435d06561dfc192e0b1" \
      io.capir.opik.jar.sha256="280f348e4e2ac6b8ef53f4a5377742214e9393260b8e067caa24c2d0a1d3687c" \
      io.capir.opik.jar.bytes="192567739" \
      io.capir.opik.jar.path="/opt/opik/opik-backend-2.2.45.jar" \
      io.capir.opik.compile-profile="opik-dd403-official-docker-build-v1"
