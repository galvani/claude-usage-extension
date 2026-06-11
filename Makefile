UUID    := claude-usage@galvani78
EXTDIR  := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: install schemas enable disable reinstall uninstall logs pack

# Symlink the repo into the extensions dir (live editing) + compile schemas.
install: schemas
	mkdir -p $(dir $(EXTDIR))
	@if [ ! -L "$(EXTDIR)" ] && [ -e "$(EXTDIR)" ]; then \
		echo "Refusing to overwrite non-symlink $(EXTDIR)"; exit 1; fi
	ln -sfn "$(CURDIR)" "$(EXTDIR)"
	@echo "Linked $(EXTDIR) -> $(CURDIR)"
	@echo "Now: make enable, then log out / back in (Wayland) to load it."

schemas:
	glib-compile-schemas schemas/

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

# Recompile schemas only (after editing the gschema.xml).
reinstall: schemas
	@echo "Schemas recompiled. Reload the shell (log out/in on Wayland)."

uninstall:
	gnome-extensions disable $(UUID) || true
	rm -f "$(EXTDIR)"
	@echo "Removed symlink $(EXTDIR)"

# Tail the shell journal filtered to this extension / GJS.
logs:
	journalctl --user -f -o cat /usr/bin/gnome-shell | grep -i --line-buffered 'claude\|ccusage\|JS ERROR'

# Build a distributable zip (excludes git/docs).
pack: schemas
	gnome-extensions pack --force \
		--extra-source=stylesheet.css \
		--schema=schemas/org.gnome.shell.extensions.claude-usage.gschema.xml \
		.
