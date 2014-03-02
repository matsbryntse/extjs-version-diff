App = {

    /**
     * @cfg url1 Set the url to first Ext JS version
     */
    url1   : 'http://lh/ext-5.0.0.470/build/ext-all-debug.js',

    /**
     * @cfg url2 Set the url to second Ext JS version
     */
    url2   : 'http://lh/extjs-4.2.2/ext-all-debug.js',

    frame1 : null,
    frame2 : null,

    ExtNew : null,
    ExtOld : null,

    // Skip some static stuff we don't care about
    staticIgnoreRe : (function () {
        var keys = Object.keys(Ext.Base).map(function (k) {
            return Ext.String.escapeRegex(k)
        });

        return new RegExp(keys.concat(['alternateClassName', 'superclass', 'hasListeners', 'HasListeners']).join('|'));
    })(),

    // Skip some prototype stuff we don't care about
    ignoreRe : (function () {
        var keys = Object.keys(Ext.Base.prototype).map(function (k) {
            return Ext.String.escapeRegex(k)
        });

        return new RegExp(keys.concat(['alternateClassName', 'superclass']).join('|'));
    })(),

    init : function () {
        var me = this;

        this.frame1 = Ext.core.DomHelper.append(Ext.getBody(), {
            tag   : "iframe",
            style : 'display:none'
        }, false);

        this.frame2 = Ext.core.DomHelper.append(Ext.getBody(), {
            tag   : "iframe",
            style : 'display:none'
        }, false);

        var win1 = this.frame1.contentWindow;

        win1.document.open();
        win1.document.write(
            '<html><head><script type="text/javascript" src="' + this.url1 + '"></script></head><body></body></html>'
        );

        win1.document.close();

        var win2 = this.frame2.contentWindow;

        win2.document.open();
        win2.document.write(
            '<html><head><script type="text/javascript" src="' + this.url2 + '"></script></head><body></body></html>'
        );

        win2.document.close();

        var int = setInterval(function () {
            if (win1.Ext && win2.Ext) {
                clearInterval(int);

                me.scan(me.visualize);
            }
        }, 200)
    },

    visualize : function(data) {
        var versionString = this.ExtNew.versions.extjs.toString();

        var newTpl = new Ext.XTemplate('<div class="addedClasses"><tpl for="."><div>{.}</div></tpl>')
        var removedTpl = new Ext.XTemplate('<div class="removedClasses"><tpl for="."><div>{.}</div></tpl>')
        var changedStaticTpl = new Ext.XTemplate('<ul class="changedStaticProperties"><tpl foreach="."><li class="clsName">{$}<ul><tpl for="."><li class="{type}"><span class="type">[{type}]</span> {prop} {[values.old ? "(old: " + values.old + ", new: " + values.new + ")" : ""]}</li></tpl></ul></li></tpl></table>')
        var changedPrototypeTpl = new Ext.XTemplate('<ul class="changedPrototypeProperties"><tpl foreach="."><li class="clsName">{$}<ul><tpl for="."><li class="{type}"><span class="type">[{type}]</span> {prop} {[values.old ? "(old: " + values.old + ", new: " + values.new + ")": ""]}</li></tpl></ul></li></tpl></table>')

        newTpl.append("one", data.added.sort());
        removedTpl.append("two", data.removed.sort());
        changedStaticTpl.append("three", data.staticChanged);
        changedPrototypeTpl.append("four", data.prototypeChanged);
    },

    // Try to get a readable type
    getType : function (obj) {
        if (obj.$className)     return obj.$className;
        if (Ext.isArray(obj))   return 'Array';
        if (Ext.isDate(obj))    return 'Date';

        return typeof obj;
    },

    getObjectDiff : function (newObj, oldObj, clsName, static) {
        var diff = []

        for (var p in oldObj) {

            if ((static ? this.staticIgnoreRe : this.ignoreRe).test(p)) continue;

            try {
                if (oldObj.hasOwnProperty(p)) {
                    // Check if the object exists on the clean window and also do a string comparison
                    // in case a builtin method has been overridden
                    if (!newObj.hasOwnProperty(p) && typeof newObj[p] == 'undefined') {
                        diff.push({
                            prop   : p,
                            type   : 'removed',
                            static : static
                        });
                    }
                    // Check for property type change
                    else if (this.getType(oldObj[p]) !== this.getType(newObj[p])) {

                        diff.push({
                            prop    : p,
                            type    : 'type_changed',
                            old     : this.getType(oldObj[p]),
                            new     : this.getType(newObj[p]),
                            static  : static
                        });
                    }
                    // Check for property value change
                    else if (Ext.isPrimitive(oldObj[p]) && oldObj[p].toString() !== newObj[p].toString()) {
                        diff.push({
                            prop    : p,
                            type    : 'value_changed',
                            old     : oldObj[p].toString(),
                            new     : newObj[p].toString(),
                            static  : static
                        });
                    }
                }
            } catch (e) {
                // Just continue
            }
        }

        return diff.sort(function(a, b) { return a.prop < b.prop ? -1 : 1; });
    },

    scan : function (callback) {
        var me = this;
        var ExtNew = this.frame1.contentWindow.Ext;
        var ExtOld = this.frame2.contentWindow.Ext;
        var staticChanged = {};
        var protChanged = {};
        var removed = [];
        var added = [];
        var i = 1;
        var processed = {};

        ExtNew = ExtNew.versions.extjs.isGreaterThan(ExtOld.versions.extjs.version) ? ExtNew : ExtOld;

        this.ExtOld = ExtOld;
        this.ExtNew = ExtNew;

        var newClasses = Object.keys(ExtNew.ClassManager.classes);
        var oldClasses = Object.keys(ExtOld.ClassManager.classes);

        // Check for native class augmentations
        oldClasses.forEach(function (cls) {

            if (processed[cls]) return;

            var clsNew = ExtNew.ClassManager.get(cls);

            if (!clsNew) {
                removed.push(cls);
            } else {
                var clsOld = ExtOld.ClassManager.get(cls);

                var diff = me.getObjectDiff(clsNew, clsOld, clsOld.$className, true);

                if (diff.length > 0) {
                    staticChanged[clsOld.$className] = diff;
                }

                // Prototype properties
                if (clsOld.prototype) {
                    var isSingleton = (clsOld.singleton || clsNew.singleton);

                    // Make subclasses to provoke additional properties being created in onClassExtended (Ext.data.Model etc)
                    var oldSub = isSingleton ? clsOld : ExtOld.define((i++).toString(), { extend : clsOld.$className });
                    var newSub = isSingleton ? clsNew : ExtNew.define((i++).toString(), { extend : clsOld.$className });

                    diff = me.getObjectDiff(newSub.prototype, oldSub.prototype, clsOld.$className);

                    if (diff.length > 0) {
                        protChanged[clsOld.$className] = diff;
                    }
                }
            }

            (Ext.isArray(cls) ? cls : [cls]).forEach(function(name) { processed[name] = 1; });
        });

        newClasses.forEach(function (cls) {

            var clsOld = ExtOld.ClassManager.get(cls);

            if (!clsOld) {
                added.push(cls);
            }
        });

        callback.call(this, {
            prototypeChanged    : protChanged,
            staticChanged       : staticChanged,
            added               : added,
            removed             : removed
        });
    }
};

Ext.onReady(App.init, App);
