#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <IOKit/IOKitLib.h>
#import <IOKit/hidsystem/IOHIDEventSystemClient.h>
#import <IOKit/hidsystem/IOHIDServiceClient.h>
#include <signal.h>
#include <unistd.h>

// Window operations and these focus transitions run on AppKit's main thread.
static NSRunningApplication *previousApplication;

void sushi_remember_frontmost(void) {
    NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
    if (app && app.processIdentifier != NSProcessInfo.processInfo.processIdentifier) {
        previousApplication = app;
    }
}

// A transparent window's shadow follows the alpha of its content: the rounded glass.
// AppKit caches that outline, so recompute it once the content has redrawn.
static void refresh_shadow(NSWindow *window) {
    // Apply the corner mask from shape_window; AppKit only re-reads it when told.
    SEL changed = NSSelectorFromString(@"_cornerMaskChanged");
    if ([window respondsToSelector:changed]) ((void (*)(id, SEL))objc_msgSend)(window, changed);
    [window invalidateShadow];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        [window invalidateShadow];
    });
}

// The web page paints no window-shaped layer, so the glass carries the legibility tint.
// As the glass's content view the fill is clipped to the glass's own continuous corner.
// NSGlassEffectView.tintColor tints too faintly for body text over a busy wallpaper.
@interface SushiTint : NSView
@end

@implementation SushiTint
- (BOOL)wantsUpdateLayer { return YES; }
- (void)updateLayer {
    BOOL dark = [[self.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] isEqual:NSAppearanceNameDarkAqua];
    NSColor *tint = dark ? [NSColor colorWithSRGBRed:24 / 255.0 green:24 / 255.0 blue:27 / 255.0 alpha:0.52]
                         : [NSColor colorWithSRGBRed:250 / 255.0 green:250 / 255.0 blue:250 / 255.0 alpha:0.56];
    self.layer.backgroundColor = tint.CGColor;
}
- (void)viewDidChangeEffectiveAppearance { self.needsDisplay = YES; }
@end

// macOS 25 and older get the untinted Visual Effect fallback.
static void tint_glass(NSWindow *window, int attempts) {
    Class glass = NSClassFromString(@"NSGlassEffectView");
    if (!glass) return;
    for (NSView *view in window.contentView.subviews) {
        if ([view isKindOfClass:glass]) {
            if (![[(id)view contentView] isKindOfClass:SushiTint.class]) {
                SushiTint *tint = [[SushiTint alloc] initWithFrame:view.bounds];
                tint.wantsLayer = YES;
                tint.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
                [(id)view setContentView:tint];
            }
            return;
        }
    }
    // Tauri inserts the glass in a later main-thread task; try again shortly.
    if (attempts <= 0) return;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        tint_glass(window, attempts - 1);
    });
}

// A borderless window has no corner mask, so the window server is free to outline, clip and
// shadow it with a shape other than the glass. Supply the glass outline: a stretchable mask
// with the same 26pt continuous corner. This overrides AppKit's private -_cornerMask (as
// Electron does for windows with rounded vibrancy); on a system without it nothing changes.
static const CGFloat CORNER = 26;

static NSImage *corner_mask(void) {
    static NSImage *mask;
    if (mask) return mask;
    CGFloat side = ceil(CORNER * 1.6) * 2 + 1, scale = 2;
    CALayer *shape = [CALayer layer];
    shape.frame = CGRectMake(0, 0, side, side);
    shape.cornerRadius = CORNER;
    shape.cornerCurve = kCACornerCurveContinuous;
    shape.backgroundColor = NSColor.blackColor.CGColor;
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(NULL, side * scale, side * scale, 8, 0, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    CGContextScaleCTM(context, scale, scale);
    [shape renderInContext:context];
    CGImageRef bitmap = CGBitmapContextCreateImage(context);
    mask = [[NSImage alloc] initWithCGImage:bitmap size:NSMakeSize(side, side)];
    CGFloat cap = floor(side / 2);
    mask.capInsets = NSEdgeInsetsMake(cap, cap, cap, cap);
    mask.resizingMode = NSImageResizingModeStretch;
    CGImageRelease(bitmap);
    CGContextRelease(context);
    CGColorSpaceRelease(space);
    return mask;
}

static void shape_window(NSWindow *window) {
    SEL selector = NSSelectorFromString(@"_cornerMask");
    Method inherited = class_getInstanceMethod(NSWindow.class, selector);
    if (!inherited) return;
    class_addMethod(window.class, selector, imp_implementationWithBlock(^NSImage *(__unused id self) { return corner_mask(); }), method_getTypeEncoding(inherited));
}

// The panel is an overlay, as Spotlight is: a non-activating NSPanel takes the keyboard without
// activating Sushi, so macOS neither leaves a full-screen app's Space nor brings Sushi forward,
// and the app underneath keeps being the one the user returns to.
@interface SushiPanel : NSPanel
@end

@implementation SushiPanel
- (BOOL)canBecomeKeyWindow { return YES; }
@end

// Tao creates the window as its own NSWindow subclass. NSPanel adds no instance variables, so
// the window becomes a panel in place, the way tauri-nspanel converts Tauri windows; tao's
// own state stays where it was allocated.
static NSPanel *as_panel(NSWindow *window) {
    if (![window isKindOfClass:NSPanel.class]) {
        if (class_getInstanceSize(NSPanel.class) != class_getInstanceSize(NSWindow.class)) return nil;
        object_setClass(window, SushiPanel.class);
    }
    return (NSPanel *)window;
}

void sushi_prepare_window(void *native) {
    NSWindow *window = (__bridge NSWindow *)native;
    NSPanel *panel = as_panel(window);
    if (panel) {
        panel.styleMask |= NSWindowStyleMaskNonactivatingPanel;
        panel.hidesOnDeactivate = NO;
        panel.becomesKeyOnlyIfNeeded = NO;
    }
    static id resized;
    if (!resized) {
        resized = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidResizeNotification object:window queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            refresh_shadow(note.object);
        }];
    }
    if (NSApp.hidden) [NSApp unhideWithoutActivation];
    shape_window(window);
    // Borderless windows have no shadow unless asked for one.
    window.hasShadow = YES;
    tint_glass(window, 40);
    // Shown on the Space the user is in, full screen included; Mission Control leaves it out
    // (transient) and window cycling skips it.
    NSWindowCollectionBehavior behavior = window.collectionBehavior;
    behavior &= ~(NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenPrimary | NSWindowCollectionBehaviorFullScreenNone |
                  NSWindowCollectionBehaviorManaged | NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorParticipatesInCycle);
    window.collectionBehavior = behavior | NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorFullScreenAuxiliary |
                                NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorIgnoresCycle;
}

void sushi_refresh_shadow(void *native) {
    refresh_shadow((__bridge NSWindow *)native);
}

// Brings the panel up and gives it the keyboard without activating Sushi. A window that could
// not become a panel falls back to activating the app, as before.
void sushi_present(void *native) {
    NSWindow *window = (__bridge NSWindow *)native;
    [window orderFrontRegardless];
    [window makeKeyWindow];
    if (![window isKindOfClass:NSPanel.class]) [NSApp activateIgnoringOtherApps:YES];
}

void sushi_restore_frontmost(void) {
    if (previousApplication && !previousApplication.terminated) {
        if (@available(macOS 14.0, *)) {
            [NSApp yieldActivationToApplication:previousApplication];
            [previousApplication activateFromApplication:NSRunningApplication.currentApplication options:0];
        } else {
            [previousApplication activateWithOptions:0];
        }
    } else {
        // Nobody to hand focus back to (e.g. shown by a reopen while already frontmost):
        // hiding the app makes the system activate the next app. sushi_prepare_window unhides.
        [NSApp hide:nil];
    }
    previousApplication = nil;
}

bool sushi_is_active(void) {
    return NSApp.active;
}

bool sushi_copy(const unsigned char *bytes, size_t count) {
    @autoreleasepool {
        NSString *text = [[NSString alloc] initWithBytes:bytes length:count encoding:NSUTF8StringEncoding];
        NSPasteboard *board = NSPasteboard.generalPasteboard;
        [board clearContents];
        return [board setString:text forType:NSPasteboardTypeString];
    }
}

// Where Launch Services finds the app with this bundle identifier, as the Finder would.
// Writes a NUL-terminated path into out and returns true, or false when no app is registered.
bool sushi_app_path(const char *bundle_id, char *out, size_t size) {
    @autoreleasepool {
        NSString *identifier = [NSString stringWithUTF8String:bundle_id];
        NSURL *url = identifier ? [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:identifier] : nil;
        return url.fileURL && [url getFileSystemRepresentation:out maxLength:size];
    }
}

// ——— Caps Lock as the hotkey ———
// While Sushi runs, every keyboard maps Caps Lock to F18 through the HID event system's
// UserKeyMapping, as `hidutil property --set` does; Sushi registers F18 as an ordinary
// hotkey. No permission is involved. Other entries of each keyboard's mapping stay.
static const unsigned long long CAPS_LOCK = 0x700000039, F18 = 0x70000006D;
static IOHIDEventSystemClientRef hid;
static bool caps_taken;
static IONotificationPortRef keyboard_port;
static io_iterator_t keyboards_added;

static NSArray *keyboards(void) {
    if (!hid) hid = IOHIDEventSystemClientCreateSimpleClient(kCFAllocatorDefault);
    NSArray *services = CFBridgingRelease(IOHIDEventSystemClientCopyServices(hid));
    NSMutableArray *found = [NSMutableArray array];
    for (id service in services) {
        // Generic Desktop / Keyboard
        if (IOHIDServiceClientConformsTo((__bridge IOHIDServiceClientRef)service, 1, 6)) [found addObject:service];
    }
    return found;
}

static NSArray<NSDictionary *> *key_mapping(id service) {
    id value = CFBridgingRelease(IOHIDServiceClientCopyProperty((__bridge IOHIDServiceClientRef)service, CFSTR("UserKeyMapping")));
    return [value isKindOfClass:NSArray.class] ? value : @[];
}

static BOOL maps_caps_lock(NSDictionary *entry) {
    return [entry[@"HIDKeyboardModifierMappingSrc"] unsignedLongLongValue] == CAPS_LOCK;
}

static BOOL is_ours(NSDictionary *entry) {
    return maps_caps_lock(entry) && [entry[@"HIDKeyboardModifierMappingDst"] unsignedLongLongValue] == F18;
}

static void set_mapping(id service, NSArray *mapping) {
    IOHIDServiceClientSetProperty((__bridge IOHIDServiceClientRef)service, CFSTR("UserKeyMapping"), (__bridge CFArrayRef)mapping);
}

static void map_all_keyboards(void) {
    for (id service in keyboards()) {
        NSArray *mapping = key_mapping(service);
        if ([mapping indexOfObjectPassingTest:^BOOL(NSDictionary *e, __unused NSUInteger i, __unused BOOL *stop) { return maps_caps_lock(e); }] != NSNotFound) continue;
        set_mapping(service, [mapping arrayByAddingObject:@{@"HIDKeyboardModifierMappingSrc": @(CAPS_LOCK), @"HIDKeyboardModifierMappingDst": @(F18)}]);
    }
}

static void drain(io_iterator_t iterator) {
    io_object_t service;
    while ((service = IOIteratorNext(iterator))) IOObjectRelease(service);
}

// A keyboard connected later gets the mapping too; the event system lists it a moment after IOKit does.
static void keyboard_added(__unused void *context, io_iterator_t iterator) {
    drain(iterator);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        if (caps_taken) map_all_keyboards();
    });
}

static void watch_keyboards(void) {
    if (keyboard_port) return;
    keyboard_port = IONotificationPortCreate(kIOMainPortDefault);
    IONotificationPortSetDispatchQueue(keyboard_port, dispatch_get_main_queue());
    if (IOServiceAddMatchingNotification(keyboard_port, kIOFirstMatchNotification, IOServiceMatching("IOHIDEventService"),
                                         keyboard_added, NULL, &keyboards_added) == KERN_SUCCESS) {
        drain(keyboards_added);
    }
}

// 0: Caps Lock now opens Sushi. 1: macOS switches input sources with Caps Lock.
// 2: another tool (Raycast's Hyper key, hidutil) already maps Caps Lock. Runs on the main thread.
int sushi_caps_take(void) {
    @autoreleasepool {
        id switching = CFBridgingRelease(CFPreferencesCopyAppValue(CFSTR("TISRomanSwitchState"), CFSTR("com.apple.HIToolbox")));
        if ([switching respondsToSelector:@selector(boolValue)] && [switching boolValue]) return 1;
        for (id service in keyboards()) {
            for (NSDictionary *entry in key_mapping(service)) {
                if (maps_caps_lock(entry) && !is_ours(entry)) return 2;
            }
        }
        caps_taken = true;
        map_all_keyboards();
        watch_keyboards();
        return 0;
    }
}

// Gives Caps Lock back. Also clears a mapping a crashed run left behind.
void sushi_caps_release(void) {
    @autoreleasepool {
        caps_taken = false;
        for (id service in keyboards()) {
            NSArray *mapping = key_mapping(service);
            NSIndexSet *ours = [mapping indexesOfObjectsPassingTest:^BOOL(NSDictionary *e, __unused NSUInteger i, __unused BOOL *stop) { return is_ours(e); }];
            if (!ours.count) continue;
            NSMutableArray *rest = [mapping mutableCopy];
            [rest removeObjectsAtIndexes:ours];
            set_mapping(service, rest);
        }
    }
}

void sushi_stage_appearance(const char *name) {
    if (!strcmp(name, "dark")) NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    else if (!strcmp(name, "light")) NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
}

// Stage mode: render the window for screenshots without anyone seeing it. WindowServer
// only composites glass over what lies below it on a display, so both the window and its
// backdrop sit under the desktop picture instead of off-screen. They never take focus.
static NSWindow *backdrop;

// Level of the desktop picture covering rect (AppKit coordinates), or NSNotFound.
// macOS 26 draws it in a WallpaperAgent window two levels below kCGDesktopWindowLevel; macOS 27
// lists no such window, and the lowest opaque full-screen window is the Window Server's own,
// three levels below. Either way the stage windows go under the lowest one found.
static NSInteger wallpaper_level(NSRect rect) {
    CGFloat top = NSMaxY(NSScreen.screens.firstObject.frame);
    CGRect target = CGRectMake(NSMinX(rect), top - NSMaxY(rect), NSWidth(rect), NSHeight(rect));
    CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    NSInteger level = NSNotFound;
    for (NSDictionary *info in (__bridge NSArray *)list) {
        CGRect bounds;
        NSInteger layer = [info[(id)kCGWindowLayer] integerValue];
        NSString *owner = [NSRunningApplication runningApplicationWithProcessIdentifier:[info[(id)kCGWindowOwnerPID] intValue]].bundleIdentifier;
        BOOL server = !owner && [info[(id)kCGWindowOwnerName] isEqual:@"Window Server"] &&
            layer < CGWindowLevelForKey(kCGDesktopWindowLevelKey);
        // Nothing above the desktop level counts: the stage must end up under the desktop, never over it.
        if (([owner isEqual:@"com.apple.wallpaper.agent"] || server || layer == CGWindowLevelForKey(kCGDesktopWindowLevelKey)) &&
            layer <= CGWindowLevelForKey(kCGDesktopWindowLevelKey) &&
            [info[(id)kCGWindowAlpha] doubleValue] == 1.0 &&
            CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds], &bounds) &&
            CGRectContainsRect(bounds, target)) {
            level = MIN(level, layer);
        }
    }
    if (list) CFRelease(list);
    return level;
}

long sushi_stage_present(void *native, const char *image_path, long *backdrop_number) {
    NSWindow *window = (__bridge NSWindow *)native;
    NSRect frame = window.frame;
    NSRect around = NSInsetRect(frame, -160, -160);
    NSInteger wallpaper = wallpaper_level(NSInsetRect(around, -80, -80));
    if (wallpaper == NSNotFound) {
        fprintf(stderr, "SUSHI_STAGE: no desktop picture covers the stage area; refusing to show windows.\n");
        return -1;
    }
    NSInteger below = wallpaper - 1;

    NSImage *image = nil;
    if (image_path) image = [[NSImage alloc] initWithContentsOfFile:@(image_path)];
    if (!image && NSScreen.mainScreen) {
        NSURL *url = [NSWorkspace.sharedWorkspace desktopImageURLForScreen:NSScreen.mainScreen];
        if (url) image = [[NSImage alloc] initWithContentsOfURL:url];
    }
    backdrop = [[NSWindow alloc] initWithContentRect:around styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    backdrop.releasedWhenClosed = NO;
    backdrop.ignoresMouseEvents = YES;
    backdrop.hasShadow = NO;
    backdrop.level = below - 1;
    NSView *content = backdrop.contentView;
    content.wantsLayer = YES;
    if (image) {
        content.layer.contents = image;
        content.layer.contentsGravity = kCAGravityResizeAspectFill;
    } else {
        CAGradientLayer *gradient = [CAGradientLayer layer];
        gradient.frame = content.bounds;
        gradient.colors = @[(id)[NSColor colorWithSRGBRed:0.10 green:0.12 blue:0.22 alpha:1].CGColor,
                            (id)[NSColor colorWithSRGBRed:0.35 green:0.15 blue:0.30 alpha:1].CGColor];
        [content.layer addSublayer:gradient];
    }
    // Under the wallpaper the window counts as occluded and WebKit would stop painting
    // after the stage script reloads the page. Stage-only use of WebKit SPI.
    SEL occlusion = NSSelectorFromString(@"_setWindowOcclusionDetectionEnabled:");
    for (NSView *parent in window.contentView.subviews) {
        for (NSView *view in [parent.subviews arrayByAddingObject:parent]) {
            if ([view respondsToSelector:occlusion]) ((void (*)(id, SEL, BOOL))objc_msgSend)(view, occlusion, NO);
        }
    }
    window.ignoresMouseEvents = YES;
    window.level = below;
    window.hasShadow = YES;
    [backdrop orderFrontRegardless];
    [window orderFrontRegardless];
    refresh_shadow(window);

    signal(SIGTERM, SIG_IGN);
    static dispatch_source_t term;
    term = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_main_queue());
    dispatch_source_set_event_handler(term, ^{ exit(0); });
    dispatch_resume(term);
    *backdrop_number = backdrop.windowNumber;
    return window.windowNumber;
}

// ——— Build info (docs/specs/build-info.md) ———
// How the running binary is signed, read from its own signature. No AppKit: `sushi version`
// runs this before NSApplication exists. Returns 0 unsigned, 1 ad-hoc, 2 ad-hoc by the linker
// (a plain cargo build), 3 Developer ID, 4 another certificate; team receives the team ID.
#import <Security/Security.h>

int sushi_signing(char *team, size_t size) {
    @autoreleasepool {
        if (size) team[0] = 0;
        SecCodeRef code = NULL;
        if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess) return 0;
        SecStaticCodeRef file = NULL;
        OSStatus status = SecCodeCopyStaticCode(code, kSecCSDefaultFlags, &file);
        CFRelease(code);
        if (status != errSecSuccess) return 0;
        CFDictionaryRef copied = NULL;
        status = SecCodeCopySigningInformation(file, kSecCSSigningInformation, &copied);
        CFRelease(file);
        if (status != errSecSuccess || !copied) return 0;
        NSDictionary *info = CFBridgingRelease(copied);
        if (!info[(__bridge NSString *)kSecCodeInfoIdentifier]) return 0;
        uint32_t flags = [info[(__bridge NSString *)kSecCodeInfoFlags] unsignedIntValue];
        // kSecCodeSignatureAdhoc and kSecCodeSignatureLinkerSigned
        if (flags & 0x20000) return 2;
        if (flags & 0x2) return 1;
        NSString *teamID = info[(__bridge NSString *)kSecCodeInfoTeamIdentifier];
        if (teamID && size) [teamID getCString:team maxLength:size encoding:NSUTF8StringEncoding];
        NSArray *certificates = info[(__bridge NSString *)kSecCodeInfoCertificates];
        NSString *leaf = certificates.count
            ? CFBridgingRelease(SecCertificateCopySubjectSummary((__bridge SecCertificateRef)certificates.firstObject))
            : nil;
        return [leaf hasPrefix:@"Developer ID Application"] ? 3 : 4;
    }
}

// ——— Diagnostics (SUSI-7, docs/specs/local-files.md LF-22) ———
// What Sushi sees without a permission one run-loop turn after the panel lost the keyboard:
// its own key window, whether it is active, the frontmost app, the on-screen windows above the
// normal level (owner, level, size; never a title) and whether Writing Tools is active in the
// panel's web view. Calls done on the main thread with one line of text.

static id find_webview(NSView *view) {
    if ([view respondsToSelector:NSSelectorFromString(@"isWritingToolsActive")]) return view;
    for (NSView *child in view.subviews) {
        id found = find_webview(child);
        if (found) return found;
    }
    return nil;
}

static NSString *owner_of(pid_t pid, NSString *fallback) {
    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    return app.bundleIdentifier ?: (fallback ?: [NSString stringWithFormat:@"pid %d", pid]);
}

// ——— The panel's own sheets (docs/specs/panel.md, PN-8) ———
// A sheet that AppKit attaches to the panel, such as the result of Writing Tools → Summary
// (SUSI-7), takes the keyboard from the panel. It is part of the panel: losing the keyboard to
// it does not hide the panel (PN-5), and losing the keyboard from it to anything else does.
static BOOL in_family(NSWindow *panel, NSWindow *window) {
    for (NSWindow *w = window; w; w = w.sheetParent) {
        if (w == panel) return YES;
    }
    return NO;
}

static NSWindow *deepest_sheet(NSWindow *panel) {
    NSWindow *sheet = panel.attachedSheet;
    while (sheet.attachedSheet) sheet = sheet.attachedSheet;
    return sheet;
}

// The panel or one of its sheets has the keyboard. Main thread only; false off it.
bool sushi_panel_family_key(void *native) {
    if (!NSThread.isMainThread) return false;
    NSWindow *panel = (__bridge NSWindow *)native;
    return panel && in_family(panel, NSApp.keyWindow);
}

// The panel lost the keyboard to its own sheet: one is attached, or one has the keyboard.
// attachedSheet is set when the sheet begins, before it takes the keyboard, so the answer
// does not depend on when tao reports the loss; tao reports it once the run-loop turn ends,
// when the key window has changed. This is the affected user's check, proven on the Summary
// sheet. Main thread only; false off it.
bool sushi_panel_keeps(void *native) {
    if (!NSThread.isMainThread) return false;
    NSWindow *panel = (__bridge NSWindow *)native;
    return panel && (panel.attachedSheet || in_family(panel, NSApp.keyWindow.sheetParent));
}

// Sushi asked macOS to make it the active app for a sheet and waits for the answer.
static BOOL activating;

// On a show while a sheet is attached, the panel comes forward and the sheet takes the keyboard,
// not the editor. The panel is the only window of Sushi that takes the keyboard without Sushi
// being the active app; a sheet is an ordinary window. It got the keyboard from the panel when
// it began, and it cannot get it that way again, because a panel under a sheet does not take
// the keyboard. So this show makes Sushi the active app, and macOS gives the keyboard to the
// sheet; hiding the panel gives the app underneath its place back (sushi_restore_frontmost).
// Returns whether a sheet was there. Main thread only.
bool sushi_present_sheet(void *native) {
    if (!NSThread.isMainThread) return false;
    NSWindow *panel = (__bridge NSWindow *)native;
    NSWindow *sheet = deepest_sheet(panel);
    if (!sheet) return false;
    [panel orderFrontRegardless];
    if (!NSApp.active) {
        activating = YES;
        [NSApp activateIgnoringOtherApps:YES];
    }
    [sheet makeKeyAndOrderFront:nil];
    return true;
}

// tao reports only the panel's own loss of the keyboard. When one of its sheets loses it,
// for a click in another app with the sheet in front, lost() hides the panel. The sheet's
// notification comes before the new key window is known, so this waits one run-loop turn:
// - the panel is hidden (the hotkey hid it with the sheet): nothing to do;
// - Sushi is becoming the active app for the sheet (sushi_present_sheet): the keyboard is on
//   its way to the sheet, and what the windows report until then is not a loss;
// - the panel has the keyboard (AppKit gives it back when the sheet closes), or another of
//   its sheets has it (a sheet of the sheet): the panel stays;
// - no window has it and no sheet is attached: the sheet closed without giving it back, so
//   the panel takes it and typing lands in the editor;
// - otherwise the keyboard left for another app or window.
// Installed once.
void sushi_watch_sheets(void *native, void (*lost)(void)) {
    static id observer;
    if (observer) return;
    NSWindow *panel = (__bridge NSWindow *)native;
    // The notification center keeps this observer for as long as Sushi runs.
    [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *note) {
        if (!activating) return;
        activating = NO;
        NSWindow *sheet = deepest_sheet(panel);
        if (panel.visible && sheet && !sheet.keyWindow) [sheet makeKeyAndOrderFront:nil];
    }];
    observer = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidResignKeyNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
        NSWindow *window = note.object;
        if (window == panel || !in_family(panel, window)) return;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!panel.visible || activating) return;
            NSWindow *key = NSApp.keyWindow;
            if (key == panel || in_family(panel, key.sheetParent)) return;
            if (!key && !panel.attachedSheet) {
                [panel makeKeyWindow];
            } else {
                lost();
            }
        });
    }];
}

// SUSHI_TEST_SHEET=1: a sheet like the one of SUSI-7, attached to the panel on its first
// show, for the regression scenario PR-10 on a Mac without Writing Tools. Main thread only.
void sushi_test_sheet(void *native) {
    static BOOL attached;
    if (attached) return;
    attached = YES;
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"Test sheet";
    alert.informativeText = @"SUSHI_TEST_SHEET attaches this sheet to the panel (PR-10).";
    [alert addButtonWithTitle:@"OK"];
    [alert beginSheetModalForWindow:(__bridge NSWindow *)native completionHandler:nil];
}

void sushi_focus_snapshot(void *native, void (*done)(const char *)) {
    NSWindow *panel = (__bridge NSWindow *)native;
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            NSMutableArray<NSString *> *parts = [NSMutableArray array];
            NSWindow *key = NSApp.keyWindow;
            [parts addObject:key ? [NSString stringWithFormat:@"key window %@ level %ld%@", NSStringFromClass(key.class), (long)key.level, key == panel ? @" (the panel)" : @""]
                                 : @"key window none in Sushi"];
            [parts addObject:[NSString stringWithFormat:@"sheet attached %@", panel.attachedSheet ? NSStringFromClass(deepest_sheet(panel).class) : @"no"]];
            [parts addObject:[NSString stringWithFormat:@"sushi active %@", NSApp.active ? @"yes" : @"no"]];
            NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
            [parts addObject:[NSString stringWithFormat:@"frontmost %@", front.bundleIdentifier ?: @"-"]];
            id webview = find_webview(panel.contentView);
            if (webview) {
                BOOL writing = ((BOOL (*)(id, SEL))objc_msgSend)(webview, NSSelectorFromString(@"isWritingToolsActive"));
                [parts addObject:[NSString stringWithFormat:@"writing tools active %@", writing ? @"yes" : @"no"]];
            } else {
                [parts addObject:@"writing tools active n/a"];
            }
            NSMutableArray<NSString *> *above = [NSMutableArray array];
            CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
            for (NSDictionary *info in (__bridge NSArray *)list) {
                NSInteger layer = [info[(id)kCGWindowLayer] integerValue];
                if (layer <= kCGNormalWindowLevel) continue;
                CGRect bounds = CGRectZero;
                CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds], &bounds);
                NSString *owner = owner_of([info[(id)kCGWindowOwnerPID] intValue], info[(id)kCGWindowOwnerName]);
                [above addObject:[NSString stringWithFormat:@"%@ level %ld %.0fx%.0f", owner, (long)layer, bounds.size.width, bounds.size.height]];
                if (above.count == 24) break;
            }
            if (list) CFRelease(list);
            [parts addObject:[NSString stringWithFormat:@"windows above normal [%@]", [above componentsJoinedByString:@", "]]];
            done([parts componentsJoinedByString:@"; "].UTF8String);
        }
    });
}

// ——— Connecting a provider (docs/specs/model.md, MD-14 and MD-13) ———
// What the key field holds, said under it: a long key scrolls a secure field and leaves a few
// dots in view, which reads as a paste that went wrong. The first and last characters are the
// ones a provider's keys page shows, so the two can be compared; a short text shows its length
// only.
static NSString *key_note(NSString *text) {
    NSString *key = [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSUInteger count = key.length;
    if (!count) return @"";
    if (count == 1) return @"1 character";
    if (count < 20) return [NSString stringWithFormat:@"%lu characters", (unsigned long)count];
    return [NSString stringWithFormat:@"%@…%@ · %lu characters", [key substringToIndex:7], [key substringFromIndex:count - 4], (unsigned long)count];
}

@interface SushiKeyNote : NSObject <NSTextFieldDelegate>
@property(nonatomic, weak) NSTextField *note;
@end

@implementation SushiKeyNote
- (void)controlTextDidChange:(NSNotification *)notification {
    NSTextField *field = notification.object;
    self.note.stringValue = key_note(field.stringValue);
}
@end

// The secure field of a connect screen with its note, as an alert's accessory view.
static NSView *key_accessory(const char *placeholder, NSSecureTextField *__strong *out) {
    NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 340, 44)];
    NSSecureTextField *field = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 20, 340, 24)];
    if (placeholder) field.placeholderString = @(placeholder);
    NSTextField *note = [NSTextField labelWithString:@""];
    note.frame = NSMakeRect(2, 0, 336, 16);
    note.font = [NSFont systemFontOfSize:NSFont.smallSystemFontSize];
    note.textColor = NSColor.secondaryLabelColor;
    note.lineBreakMode = NSLineBreakByTruncatingMiddle;
    SushiKeyNote *watcher = [SushiKeyNote new];
    watcher.note = note;
    field.delegate = watcher;
    // The field does not keep its delegate; the view does.
    static char kept;
    objc_setAssociatedObject(view, &kept, watcher, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [view addSubview:field];
    [view addSubview:note];
    *out = field;
    return view;
}

// An alert in front of every app; returns the button pressed, 0 for the first. buttons holds
// the titles separated by '\n'. With secure set, the alert has a secure text field for a pasted
// key, whose text is written to secure (at most size bytes, NUL-terminated): the key never
// passes through the page. Main thread only.
int sushi_alert(const char *title, const char *text, const char *buttons, char *secure, size_t size, const char *placeholder) {
    @autoreleasepool {
        NSAlert *alert = [NSAlert new];
        alert.messageText = @(title);
        alert.informativeText = @(text);
        for (NSString *button in [@(buttons) componentsSeparatedByString:@"\n"]) [alert addButtonWithTitle:button];
        NSSecureTextField *field = nil;
        if (secure && size) {
            secure[0] = 0;
            alert.accessoryView = key_accessory(placeholder, &field);
            [alert layout];
            alert.window.initialFirstResponder = field;
        }
        [NSApp activateIgnoringOtherApps:YES];
        NSModalResponse response = [alert runModal];
        if (field) {
            const char *value = field.stringValue.UTF8String;
            strlcpy(secure, value ? value : "", size);
            field.stringValue = @"";
        }
        return (int)(response - NSAlertFirstButtonReturn);
    }
}

// ——— A problem report's snapshot (docs/specs/report.md, RP-6) ———
#import <Carbon/Carbon.h>

// The identifier of the current keyboard input source, such as com.apple.keylayout.US.
void sushi_input_source(char *out, size_t size) {
    @autoreleasepool {
        if (size) out[0] = 0;
        TISInputSourceRef source = TISCopyCurrentKeyboardInputSource();
        if (!source) return;
        CFStringRef identifier = TISGetInputSourceProperty(source, kTISPropertyInputSourceID);
        if (identifier) CFStringGetCString(identifier, out, (CFIndex)size, kCFStringEncodingUTF8);
        CFRelease(source);
    }
}

// Whether macOS uses the dark appearance, as the panel follows it.
bool sushi_dark(void) {
    // Light mode has no AppleInterfaceStyle at all: a nil style must not compare as equal.
    NSString *style = [NSUserDefaults.standardUserDefaults stringForKey:@"AppleInterfaceStyle"];
    return style && [style caseInsensitiveCompare:@"Dark"] == NSOrderedSame;
}

// ——— The settings window (SUSI-12) ———
// A normal window of an accessory app: opening it activates Sushi so the window takes the
// keyboard, on the Space the user is in. sushi_prepare_window never touches it. Main thread only.
void sushi_activate_window(void *native) {
    NSWindow *window = (__bridge NSWindow *)native;
    if (!window) return;
    window.collectionBehavior |= NSWindowCollectionBehaviorMoveToActiveSpace;
    if (NSApp.hidden) [NSApp unhideWithoutActivation];
    [NSApp activateIgnoringOtherApps:YES];
    [window makeKeyAndOrderFront:nil];
}

// The alert of sushi_alert as a sheet of window, for a connect or disconnect flow the settings
// window started: done(context, button, key) runs once on the main thread when it ends, with
// the text of the secure field when secure is set (the key never passes through the page).
// Returns false when window cannot take a sheet; done is then never called. Main thread only.
typedef void (*sushi_alert_done)(void *context, int pressed, const char *key);

bool sushi_alert_sheet(void *native, const char *title, const char *text, const char *buttons, bool secure, const char *placeholder, sushi_alert_done done, void *context) {
    NSWindow *window = (__bridge NSWindow *)native;
    if (!window || !window.visible) return false;
    NSAlert *alert = [NSAlert new];
    alert.messageText = @(title);
    alert.informativeText = @(text);
    for (NSString *button in [@(buttons) componentsSeparatedByString:@"\n"]) [alert addButtonWithTitle:button];
    NSSecureTextField *field = nil;
    if (secure) {
        alert.accessoryView = key_accessory(placeholder, &field);
        [alert layout];
        alert.window.initialFirstResponder = field;
    }
    [NSApp activateIgnoringOtherApps:YES];
    [window makeKeyAndOrderFront:nil];
    [alert beginSheetModalForWindow:window completionHandler:^(NSModalResponse response) {
        const char *value = field ? field.stringValue.UTF8String : NULL;
        done(context, (int)(response - NSAlertFirstButtonReturn), value ? value : "");
        field.stringValue = @"";
    }];
    return true;
}

// A folder picker, directories only, as a sheet of window. done(context, path) runs once on
// the main thread: the chosen folder, or NULL for a cancel. A window that is hidden or gone is a
// cancel: the picker never opens on its own over another app. Main thread only.
typedef void (*sushi_folder_done)(void *context, const char *path);

void sushi_choose_folder(void *native, const char *start, sushi_folder_done done, void *context) {
    NSWindow *window = (__bridge NSWindow *)native;
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = NO;
    panel.canChooseDirectories = YES;
    panel.canCreateDirectories = YES;
    panel.allowsMultipleSelection = NO;
    panel.prompt = @"Choose";
    panel.message = @"Choose the folder of your prompts. Sushi reads it and moves nothing.";
    if (start) panel.directoryURL = [NSURL fileURLWithPath:@(start) isDirectory:YES];
    void (^finish)(NSModalResponse) = ^(NSModalResponse response) {
        NSString *path = response == NSModalResponseOK ? panel.URL.path : nil;
        done(context, path ? path.fileSystemRepresentation : NULL);
    };
    if (window && window.visible) {
        [panel beginSheetModalForWindow:window completionHandler:finish];
    } else {
        done(context, NULL);
    }
}

// ——— The menu's shortcut hint for Caps Lock (SUSI-12) ———
// The tray sets its menu on the status item only while the user opens it, so the hint is set
// on that menu as it arrives: Show Sushi gets ⇪ as its key equivalent with no modifiers, as a
// combination gets its own through the native accelerator.
static BOOL capsHint;

static void apply_caps_hint(NSMenu *menu) {
    if (!menu || !capsHint) return;
    NSMenuItem *item = [menu itemWithTitle:@"Show Sushi"];
    if (!item) return;
    item.keyEquivalent = @"⇪";
    item.keyEquivalentModifierMask = 0;
}

@interface SushiStatusMenuWatcher : NSObject
@end

@implementation SushiStatusMenuWatcher
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
    if ([object isKindOfClass:NSStatusItem.class]) apply_caps_hint(((NSStatusItem *)object).menu);
}
@end

// Turns the hint on or off for the menu of status_item; false when the item cannot be reached,
// and the row then names the key in its title. Main thread only.
bool sushi_menu_caps_hint(void *status_item, bool on) {
    if (!NSThread.isMainThread) return false;
    id item = (__bridge id)status_item;
    if (![item isKindOfClass:NSStatusItem.class]) return false;
    static SushiStatusMenuWatcher *watcher;
    static __weak NSStatusItem *watched;
    capsHint = on;
    if (watched != item) {
        if (!watcher) watcher = [SushiStatusMenuWatcher new];
        [item addObserver:watcher forKeyPath:@"menu" options:NSKeyValueObservingOptionNew context:NULL];
        watched = item;
    }
    apply_caps_hint(((NSStatusItem *)item).menu);
    return true;
}

// ——— The settings window and its sheets as one family (SUSI-12) ———
// A folder picker or a connect screen attached to the settings window has the keyboard in
// place of the window: for the panel's focus return they are the window. Main thread only.
bool sushi_window_family_key(void *native) {
    if (!NSThread.isMainThread) return false;
    NSWindow *window = (__bridge NSWindow *)native;
    return window && window.visible && in_family(window, NSApp.keyWindow);
}

// Gives the keyboard back to the window, or to its deepest attached sheet. Main thread only.
void sushi_window_family_focus(void *native) {
    NSWindow *window = (__bridge NSWindow *)native;
    if (!window) return;
    if (NSApp.hidden) [NSApp unhideWithoutActivation];
    [NSApp activateIgnoringOtherApps:YES];
    NSWindow *sheet = deepest_sheet(window);
    [window makeKeyAndOrderFront:nil];
    if (sheet) [sheet makeKeyAndOrderFront:nil];
}

// ——— Keys held while the key that shows Sushi pauses (SUSI-12) ———
// Whether any of the key codes is down, or all of the modifier flags are, as the HID system
// sees them now. Any thread.
bool sushi_keys_down(unsigned long long flags, const unsigned short *codes, size_t count) {
    for (size_t i = 0; i < count; i++) {
        if (CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, (CGKeyCode)codes[i])) return true;
    }
    if (!flags) return false;
    return (CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState) & flags) == flags;
}
